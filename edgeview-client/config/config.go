package config

import (
	"github.com/zededa/zedcloud/libs/zcert"
	configModels "github.com/zededa/zedcloud/libs/zconfig/models"
	"github.com/zededa/zedcloud/libs/zlog"
)

type EdgeViewService struct {
	HealthPort           int           `cfg:"EDGEVIEW_SERVICE_HEALTH_PORT"`
	HealthCheckFrequency uint64        `cfg:"HEALTH_CHECK_FREQUENCY" default:"5"`
	LogLevel             zlog.LogLevel `cfg:"EDGEVIEW_SERVICE_LOG_LEVEL" default:"0"`
	ClientMinVersion     string        `cfg:"EDGEVIEW_SERVICE_CLIENT_MIN_VERSION" default:"6.7.0"`
	DefaultDispatcherURL string        `cfg:"EDGEVIEW_DEFAULT_DISPATCHER_URL"`
	TrustCertDetails     TrustCertDetails
	Postgres             configModels.Postgres
	Redis                configModels.Redis
	RedisJWT             configModels.Redis
	JWTAuthDetail        JWTAuthConfig
	RedisEdgeView        configModels.Redis
	KafkaProducer        configModels.Kafka
	KafkaConsumer        configModels.Kafka
	KafkaConsumerTopics  []string `cfg:"EDGEVIEW_SERVICE_KAFKA_CONSUMER_TOPICS"`
	Web                  WebServer
	PprofEnabled         bool `cfg:"EDGEVIEW_SERVICE_PPROF_ENABLED" default:"false"`
	ZIAMService          configModels.ZIAMService
}

// TrustCertDetails is the configuration for trust certificate.
type TrustCertDetails struct {
	CertPath       string `cfg:"EDGEVIEW_TRUST_CERT_PATH" default:"/opt/zededa/etc/"`
	SigningKeyName string `cfg:"EDGEVIEW_TRUST_SIGNING_KEY_NAME" default:"zedcloud.signing.key.pem"`
}

// ToZCert converts TrustCertDetails to zcert.CertificateDetail
func (cd TrustCertDetails) ToZCert() zcert.CertificateDetail {
	return zcert.CertificateDetail{
		CertPath:       cd.CertPath,
		SigningKeyName: cd.SigningKeyName,
	}
}

type JWTAuthConfig struct {
	CustomClaimNamespace string `cfg:"EDGEVIEW_SERVICE_JWT_AUTH_CONFIG"`
}

// WebServer is the configuration for a web server.
type WebServer struct {
	Port   int    `cfg:"EDGEVIEW_SERVICE_WEB_SERVER_PORT" default:"8904"`
	Server string `cfg:"EDGEVIEW_SERVICE_WEB_SERVER" default:"0.0.0.0"`
}
