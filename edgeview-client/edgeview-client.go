//nolint:gosec,govet,lll,ineffassign,errcheck,gochecknoglobals
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.opentelemetry.io/otel"

	"github.com/zededa/zcommon/zcconfig"
	"github.com/zededa/zcommon/zclog"
	"github.com/zededa/zedcloud/libs/cryptography"
	"github.com/zededa/zedcloud/libs/database/driver/postgresdb"
	"github.com/zededa/zedcloud/libs/dependency"
	"github.com/zededa/zedcloud/libs/health"
	"github.com/zededa/zedcloud/libs/hutils"
	"github.com/zededa/zedcloud/libs/metrics"
	"github.com/zededa/zedcloud/libs/opentelemetry"
	"github.com/zededa/zedcloud/libs/setup/middleware"
	"github.com/zededa/zedcloud/libs/zinfra"
	"github.com/zededa/zedcloud/libs/zka"
	"github.com/zededa/zedcloud/libs/zredis"
	"github.com/zededa/zedcloud/libs/zsrv"
	"github.com/zededa/zedcloud/srvs/edgeview-client/config"
)

const (
	schemaName  = "edgeview_client"
	serviceName = "edgeview-client"
)

var (
	// variables set during docker build
	version   = "dev"
	commit    = "unknown"
	buildTime = ""

	// shared clients
	hkafka zka.KafkaSNode

	apiRespTopic         = zka.KApiRespTopic + "-" + uuid.New().String()
	signingPrivateKey    []byte
	cryptoClient         cryptography.CryptoClientInterface
	DefaultDispatcherURL string
)

// websocket upgrader
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type wsWriter struct {
	conn *websocket.Conn
}

func (w *wsWriter) Write(p []byte) (int, error) {
	err := w.conn.WriteMessage(websocket.TextMessage, p)
	return len(p), err
}

type service struct {
	cfg                config.EdgeViewService
	rClient            zredis.ZRedisClient
	rJWTClient         zredis.ZRedisClient
	rEdgeViewClient    zredis.ZRedisClient
	postgresMetricsCtx *metrics.DatabaseHealthStat
	healthMetrics      zinfra.HealthMetricContext
	upgradePending     bool
	mu                 sync.Mutex
}

func newService(cfg config.EdgeViewService) *service {
	return &service{
		cfg:            cfg,
		upgradePending: false,
		mu:             sync.Mutex{},
	}
}

// initDependencies creates all necessary clients for the service dependencies.
func (srv *service) initDependencies() error {
	var err error
	// init Redis
	srv.rClient, err = dependency.InitRedisClient(srv.cfg.Redis, zredis.REDIS_USER_SESSION)
	if err != nil {
		return fmt.Errorf("initializing redis client: %w", err)
	}
	zclog.Debug(context.TODO()).Msg("redis client initialized successfully")

	// init redis JWT
	srv.rJWTClient, err = dependency.InitRedisClient(srv.cfg.RedisJWT, zredis.REDIS_JWT_SESSION)
	if err != nil {
		return fmt.Errorf("initializing redis JWT client: %w", err)
	}
	zclog.Debug(context.TODO()).Msg("redis JWT client initialized successfully")

	// init Redis EdgeView
	srv.rEdgeViewClient, err = dependency.InitRedisClient(srv.cfg.RedisEdgeView, zredis.REDIS_USER_SESSION)
	if err != nil {
		return fmt.Errorf("initializing redis edgeview client: %w", err)
	}
	zclog.Debug(context.TODO()).Msg("redis edgeview client initialized successfully")

	// init postgres
	srv.cfg.Postgres.SchemaName = schemaName
	err = dependency.InitPostgresClient(srv.cfg.Postgres, InitAllDBs, serviceName)
	if err != nil {
		return fmt.Errorf("initializing postgres client: %w", err)
	}
	zclog.Debug(context.TODO()).Msg("postgres client initialized successfully")

	// init kafka producer
	brokerURL := zsrv.GetServiceAddress(srv.cfg.KafkaProducer.Server, srv.cfg.KafkaProducer.Port)
	srv.cfg.KafkaProducer.SetResponseTopics([]string{apiRespTopic})
	srv.mu.Lock()
	hkafka, _ = dependency.InitKafkaProducerClient(srv.cfg.KafkaProducer, brokerURL, serviceName)
	srv.mu.Unlock()
	zclog.Debug(context.TODO()).Msg("kafka producer client initialized successfully")

	// init kafka consumer
	srv.cfg.KafkaConsumer.SetConsumerTopics(srv.cfg.KafkaConsumerTopics)
	srv.cfg.KafkaConsumer.SetConsumerTopics([]string{apiRespTopic})
	dependency.InitKafkaConsumer(hkafka, srv.cfg.KafkaConsumer, serviceName)
	zclog.Debug(context.TODO()).Msg("kafka consumer client initialized successfully")

	// initialize health context
	srv.setHealthMetricsCtx(srv.cfg.HealthCheckFrequency)
	zclog.Debug(context.TODO()).Msg("health check context initialized successfully")

	// run seb server
	err = srv.runWebServer()
	if err != nil {
		return fmt.Errorf("initializing web server: %w", err)
	}
	zclog.Debug(context.TODO()).Msg("web server initialized successfully")

	return nil
}

func (srv *service) setHealthMetricsCtx(frequency uint64) {
	healthCtx, err := zsrv.NewHealthSrvs("edgeview-client")
	if err != nil {
		zclog.Warn(context.TODO()).Err(err).Msg("initializing health context")
		return
	}
	zclog.Info(context.TODO()).Msg("starting health monitoring service")
	srv.postgresMetricsCtx = postgresdb.NewPostgresStat(serviceName)
	srv.healthMetrics.NewHealthMetricsContext(
		zinfra.WithHealthContext(healthCtx),
		zinfra.WithKafkaContext(hkafka),
		zinfra.WithPostgresDbContext(srv.postgresMetricsCtx, true, nil, nil),
		zinfra.WithUpgradePending(&srv.upgradePending),
	)
	go srv.sendMicroserviceHealthReport(frequency)
}

func (srv *service) sendMicroserviceHealthReport(healthStatusSendInterval uint64) {
	ticker := time.NewTicker(time.Duration(healthStatusSendInterval) * time.Second)
	for range ticker.C {
		res, connPoolStat, err := dbcx.DBConnectionStatus()
		if connPoolStat != nil {
			connPoolStat.TotalAllocatedPoolSize = srv.cfg.Postgres.ConnPoolSize
		}
		// ping postgres and update the health report
		srv.healthMetrics.NewHealthMetricsContext(
			zinfra.WithPostgresDbContext(srv.postgresMetricsCtx, res, connPoolStat, err))
		srv.healthMetrics.FillhealthReportCommon()
	}
}

func (srv *service) runWebServer() error {
	hCtx, err := hutils.NewConnect("edgeview-client", false, nil)
	if err != nil {
		zclog.Error(context.TODO()).Err(err).Msg("creating web service")
		return fmt.Errorf("creating web service: %w", err)
	}
	err = hCtx.SetMinClientVersion(srv.cfg.ClientMinVersion)
	if err != nil {
		zclog.Error(context.TODO()).Err(err).Msg("setting min client version")
	}

	// note, all routes use the same middleware, so we only register it once on the root router.
	hCtx.Router.Use(hutils.CtxMiddleware)
	hCtx.Router.Use(opentelemetry.WithRequestMetricsMiddleware(otel.GetMeterProvider()))
	hCtx.Router.Use(middleware.Auth(srv.rClient, srv.rJWTClient, srv.cfg.JWTAuthDetail.CustomClaimNamespace))
	hCtx.Router.Use(hutils.ResponseLogginMiddleware)

	routeV1 := "/api/v1"
	routes := []hutils.RouteSetup{
		edgeViewRoutes(),
	}
	hCtx.SetupRoutes(routeV1, routes...)

	initOpts()
	go func() {
		csrfProtectedPath := "/api"
		broker := zsrv.GetServiceAddress(srv.cfg.Web.Server, srv.cfg.Web.Port)
		err = hCtx.ListenAndServe(broker, false, csrfProtectedPath)
		if err != nil {
			zclog.Fatal(context.TODO()).Err(err).Msg("starting web service")
		}
	}()

	return nil
}

// cryptoHandler initializes security related methods.
func (srv *service) cryptoHandler() {
	// create crypto client
	cryptoClient = cryptography.NewCryptoClient()

	// get the signing cert chain and private key
	DefaultDispatcherURL = srv.cfg.DefaultDispatcherURL
	keyPath := srv.cfg.TrustCertDetails.CertPath + srv.cfg.TrustCertDetails.SigningKeyName
	if keyPath == "" {
		keyPath = "zedcloud.signing.key.pem"
	}

	// read private signing key.
	var gErr error
	signingPrivateKey, gErr = os.ReadFile(keyPath)
	if gErr != nil {
		zclog.Error(context.TODO()).Err(gErr).Msg("reading signing key file")
		return
	}
}

func main() {
	useConfigDefaults := true
	certificates := []string{
		"zedcloud.signing.key.pem",
	}

	bgCtx := context.Background()
	configParser, err := zcconfig.NewConfigFactory(bgCtx, useConfigDefaults, certificates, "edgeview-client")
	if err != nil {
		zclog.Error(bgCtx).Err(err).Msg("creating config parser")
		return
	}

	cfg := config.EdgeViewService{}
	err = configParser.Parse(bgCtx, &cfg)
	if err != nil {
		zclog.Error(bgCtx).Err(err).Msg("parsing config")
		return
	}

	logConfig := zclog.Config{
		Level: zclog.LogLevel(cfg.LogLevel),
	}
	ctx := zclog.NewLogger(logConfig).
		With().
		Str("service", serviceName).
		Logger().
		WithContext(context.Background())

	c := make(chan os.Signal, 1)
	done := make(chan bool)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		for sig := range c {
			zclog.Error(ctx).Any("signal", sig).Msg("received signal")
			done <- true
		}
	}()

	// initialize
	srv := newService(cfg)

	// initialize all security related methods.
	srv.cryptoHandler()

	// servicesStarted is used by the health check service to verify if all dependencies have been started.
	var servicesStarted atomic.Bool
	// Create a channel to receive the error from the goroutine
	errChan := make(chan error)
	go func() {
		errChan <- srv.initDependencies()
	}()

	healthContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		healthService, err := health.New(
			health.WithName("edgeview-client"),
			health.WithVersion(version),
			health.WithBuildTime(buildTime),
			health.WithCommit(commit),
			health.WithAddress(fmt.Sprintf(":%d", srv.cfg.HealthPort)),
			health.WithPprof(cfg.PprofEnabled),
			health.WithReadyStatusFunc(func(ctx context.Context, svc *health.Service) (health.Status, error) {
				if !servicesStarted.Load() {
					return health.Status{
						Status:  health.NotReadyStatus,
						Details: map[string]any{"details": "never became ready"},
					}, nil
				}
				return health.Status{
					Status: svc.GetDetailedStatus(ctx).Status.Status,
				}, nil
			}),
			health.WithLiveStatusFunc(func(ctx context.Context, svc *health.Service) (health.Status, error) {
				if !servicesStarted.Load() {
					return health.Status{
						Status:  health.NotLiveStatus,
						Details: map[string]any{"details": "never became ready"},
					}, nil
				}
				return health.Status{
					Status: svc.GetDetailedStatus(ctx).Status.Status,
				}, nil
			}),
			health.WithHealthStatusFunc(func(ctx context.Context, _ *health.Service) (health.DetailedStatus, error) {
				if !servicesStarted.Load() {
					return health.DetailedStatus{
						Status: health.Status{
							Status:  health.NotReadyStatus,
							Details: map[string]any{"details": "never became ready"},
						},
					}, nil
				}
				srv.mu.Lock()
				defer srv.mu.Unlock()
				return health.DetailedStatus{
					Status: health.Status{
						Status: health.OKStatus,
					},
					Dependencies: []health.DetailedStatus{
						health.KafkaDependencyCheck(ctx, "kafka", hkafka),
						health.PostgresDependencyCheck(ctx, "postgres", dbcx),
						health.RedisDependencyCheck(ctx, "redis", srv.rEdgeViewClient),
					},
				}, nil
			}),
		)
		if err != nil {
			zclog.Fatal(ctx).Msg("unable to create health service")
		}
		if err := healthService.Run(healthContext, slog.Default()); err != nil {
			zclog.Error(ctx).Err(err).Msg("serving health")
		}
	}()

	// block by waiting for the goroutine to finish
	err = <-errChan
	if err != nil {
		zclog.Error(ctx).Err(err).Msg("initializing dependencies")
		return
	}
	// mark dependencies as fully running
	servicesStarted.Store(true)
	zclog.Debug(ctx).Msg("dependencies initialized successfully")

	<-done
}
