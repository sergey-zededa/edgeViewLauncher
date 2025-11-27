//nolint:gosec,govet,lll,ineffassign,errcheck
package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"

	"github.com/gorilla/websocket"
	"github.com/zededa/zedcloud/libs/edgeview"
	"github.com/zededa/zedcloud/libs/hutils"
	"github.com/zededa/zedcloud/libs/zmsg"
	"github.com/zededa/zedcloud/libs/zmsg/device"
	edgeviewapi "github.com/zededa/zedcloud/libs/zmsg/edgeview"
	"github.com/zededa/zedcloud/libs/zutils"
)

func edgeViewRoutes() hutils.RouteSetup {
	m := hutils.RouteSetup{
		NewSubRoute: "/edgeview",
		Config: hutils.RouteConfig{
			"GET": {
				"/id/{sessionId:" + zutils.COMMON_NAME_URL + "}/check": hutils.HttpApiFunc{Fn: edgeviewCheckHandler, Enc: "jsonpb"},
				"/id/{sessionId:" + zutils.COMMON_NAME_URL + "}/fetch": hutils.HttpApiFunc{Fn: edgeviewFetchResultHandler, Enc: "jsonpb"},
				"/stats": hutils.HttpApiFunc{Fn: edgeviewStatsHandler, Enc: "jsonpb"},
				"/ssh":   hutils.HttpApiFunc{Fn: edgeViewSshHandler, Enc: "jsonpb"},
				"/id/{sessionId:" + zutils.COMMON_NAME_URL + "}/download": hutils.HttpApiFunc{Fn: edgeviewDownloadHandler},
			},
			"POST": {
				"/command": hutils.HttpApiFunc{Fn: edgeViewCommandHandler, Enc: "jsonpb"},
				"/id/{sessionId:" + zutils.COMMON_NAME_URL + "}/stop": hutils.HttpApiFunc{Fn: edgeviewStopHandler, Enc: "jsonpb"},
			},
			"DELETE": {},
			"PUT":    {},
			"OPTIONS": {
				"/": hutils.HttpApiFunc{Fn: optionsHandler, Enc: "jsonpb"},
			},
		},
	}

	return m
}

func optionsHandler(_ *hutils.Mcontext) (int, interface{}) {
	return http.StatusOK, nil
}

func edgeviewCheckHandler(ctx *hutils.Mcontext) (int, interface{}) {
	sessionId := ctx.Params("sessionId")
	if sessionId == "" {
		eresult := zmsg.ZsrvBadParams()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	sessionInfo := getSession(sessionId)
	if sessionInfo == nil {
		eresult := zmsg.ZsrvObjNotFound()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	// Check if the session command is "tcp/"
	response := new(device.EdgeviewResponse)
	if strings.HasPrefix(sessionInfo.Command, "tcp/") {
		tcpOn := edgeview.IstcpClientRun(sessionInfo.DevId, int(sessionInfo.InstNum), clientStateMap)
		response.SessionId = sessionId
		response.InstNum = sessionInfo.InstNum
		response.ConnectionOn = tcpOn
		response.RequestDone = sessionInfo.RequestDone
		response.Errors = sessionInfo.Errors
		response.Status = sessionInfo.Status
		response.PortMapping = sessionInfo.PortMapping
	} else if strings.HasPrefix(sessionInfo.Command, "collectinfo") {
		var starttime int64
		if !sessionInfo.Pbar.StartedTime.IsZero() {
			starttime = sessionInfo.Pbar.StartedTime.Unix()
		}
		response.SessionId = sessionId
		response.InstNum = sessionInfo.InstNum
		response.FileSize = uint64(sessionInfo.Pbar.FileSize)
		response.FileName = sessionInfo.Pbar.Filename
		response.CurrSize = uint64(sessionInfo.Pbar.CurrSize)
		response.StartTime = uint64(starttime)
		response.RequestDone = sessionInfo.RequestDone
		response.Status = sessionInfo.Status
	} else {
		response.SessionId = sessionId
		response.InstNum = sessionInfo.InstNum
		response.RequestDone = sessionInfo.RequestDone
	}
	fmt.Printf("edgeviewCheckHandler: resp %+v\n", response)

	return http.StatusOK, response
}

func edgeviewFetchResultHandler(ctx *hutils.Mcontext) (int, interface{}) {
	sessionId := ctx.Params("sessionId")
	if sessionId == "" {
		eresult := zmsg.ZsrvBadParams()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	sessionInfo := getSession(sessionId)
	if sessionInfo == nil {
		eresult := zmsg.ZsrvObjNotFound()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	if !sessionInfo.RequestDone {
		eresult := zmsg.ZsrvForbidden()
		eresult.HttpStatusMsg = "file transfer not done yet"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	filteredText := getRuturnTextString(sessionInfo.Command, sessionInfo.Buffer)
	// Prepare the response
	response := new(device.EdgeviewResponse)
	response.InstNum = sessionInfo.InstNum
	response.RespText = filteredText
	if sessionInfo.Status == "" {
		response.Status = edgeview.GetEvRetStatusMeaning(edgeview.SessionDone)
	} else {
		response.Status = sessionInfo.Status
	}

	// Remove the session from the map after the file is served
	removeSession(sessionId)

	return http.StatusOK, response
}

func edgeviewStatsHandler(ctx *hutils.Mcontext) (int, interface{}) {
	buf := &bytes.Buffer{}
	edgeview.CheckEdgeviewStats(buf, clientStateMap, evtcpMapping)

	sessionMaps := "\nSession Maps:\n"
	sessionMapMutex.Lock()
	for sessionId, sessionInfo := range sessionMap {
		sessionMaps += fmt.Sprintf("SessionId: %s, DevId: %s, InstNum: %d, Command: %s, Buffer %d, Request-Done %v, Errors %v, Status %v\n",
			sessionId,
			sessionInfo.DevId,
			sessionInfo.InstNum,
			sessionInfo.Command,
			func() int {
				if sessionInfo.Buffer != nil {
					return len(sessionInfo.Buffer.Bytes())
				}
				return 0
			}(),
			sessionInfo.RequestDone,
			sessionInfo.Errors,
			sessionInfo.Status)
	}
	sessionMaps += "\n"
	sessionMapMutex.Unlock()

	// Prepare the response
	response := new(device.EdgeviewResponse)
	response.RespText = buf.String() + sessionMaps

	return http.StatusOK, response
}

func edgeViewCommandHandler(ctx *hutils.Mcontext) (int, interface{}) {
	jsonInput := device.EdgeviewRequest{}

	err := ctx.ReadJSONPB(&jsonInput)
	if err != nil {
		dresult := zmsg.ZsrvBadInput()
		dresult.HttpStatusMsg = err.Error()
		return int(dresult.GetHttpStatusCode()), dresult
	}

	_, _, _, _, jdata, authenType, err := edgeview.GetAddrFromJWT(jsonInput.GetJwt(), 1)
	if err != nil {
		eresult := zmsg.ZsrvBadInput()
		eresult.HttpStatusMsg = fmt.Sprintf("invalid jwt: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	// If the JWT Authentication type is SSH_RSA_KEYS, we do not support it
	// the controller side does not have the private SSH key to sign the request
	if authenType == edgeviewapi.EvAuthType_EvAuth_TYPE_SSH_RSA_KEYS {
		eresult := zmsg.ZsrvBadInput()
		eresult.HttpStatusMsg = "Edgeview Remote Access with SSH key authentication is not supported"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	if jsonInput.Command == "" {
		eresult := zmsg.ZsrvBadInput()
		eresult.HttpStatusMsg = "invalid command"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	if jsonInput.UserInfo == "" {
		eresult := zmsg.ZsrvBadInput()
		eresult.HttpStatusMsg = "invalid user info"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	// Pick an unused instance number if available using lightweight HTTP verification with fallback
	instNum, err := edgeview.VerifyEvInstanceHttp(1, int(jdata.Num), jsonInput.Jwt, jsonInput.UserInfo,
		clientStateMap, evtcpMapping, netopts, sysopts)
	if err != nil {
		eresult := zmsg.ZsrvBadInput()
		eresult.HttpStatusMsg = fmt.Sprintf("can not get instance: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	// Generate a new session Id
	sessionId, err := generateSessionId()
	if err != nil {
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("error generating session id: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	jsonInput.DevId = jdata.Sub
	jsonInput.SessionId = sessionId
	jsonInput.InstNum = uint32(instNum)
	fmt.Printf("edgeviewHandler: sessionId %s, devId %s, instNum %d, command %s\n",
		jsonInput.SessionId, jsonInput.DevId, jsonInput.InstNum, jsonInput.Command)

	response := new(device.EdgeviewResponse)
	if strings.HasPrefix(jsonInput.Command, "tcp/") {
		response, err = runEdgeViewStartTCPHandler(&jsonInput)
	} else if jsonInput.Command == "collectinfo" {
		response, err = runEdgeViewCollectInfoHandler(&jsonInput)
	} else {
		if jsonInput.AsyncOp {
			response, err = runEdgeviewGenericAsyncHandler(&jsonInput)
		} else {
			response, err = runEdgeviewGenericHandler(ctx.GetCtx(), &jsonInput)
		}
	}
	if err != nil {
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = err.Error()
		return int(eresult.GetHttpStatusCode()), eresult
	}
	return http.StatusOK, response
}

func edgeviewStopHandler(ctx *hutils.Mcontext) (int, interface{}) {
	sessionId := ctx.Params("sessionId")
	if sessionId == "" {
		eresult := zmsg.ZsrvBadParams()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	sessionInfo := getSession(sessionId)
	if sessionInfo == nil {
		eresult := zmsg.ZsrvObjNotFound()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	if strings.HasPrefix(sessionInfo.Command, "tcp/") {
		if edgeview.IstcpClientRun(sessionInfo.DevId, int(sessionInfo.InstNum), clientStateMap) {
			if sessionInfo.Cancel != nil {
				sessionInfo.Cancel()
			}
		}
	} else if strings.HasPrefix(sessionInfo.Command, "collectinfo") {
		// cancel the collectinfo session
		if sessionInfo.Cancel != nil {
			sessionInfo.Cancel()
		}
	} else {
		// do we use cancel here for non-tcp command?
		// we don't see to need this ChanDone, not used, and comment this out.
		// sendTrigtoChan(sessionInfo.ChanDone)
	}

	// Remove the session from the map
	removeSession(sessionId)

	return http.StatusOK, nil
}

func edgeviewDownloadHandler(ctx *hutils.Mcontext) (int, interface{}) {
	sessionId := ctx.Params("sessionId")
	if sessionId == "" {
		eresult := zmsg.ZsrvBadParams()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	sessionInfo := getSession(sessionId)
	if sessionInfo == nil {
		eresult := zmsg.ZsrvObjNotFound()
		return int(eresult.GetHttpStatusCode()), eresult
	}

	if !sessionInfo.RequestDone {
		eresult := zmsg.ZsrvForbidden()
		eresult.HttpStatusMsg = "file transfer not done yet"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	filePath := filepath.Join("/tmp/download", sessionInfo.DevId, sessionInfo.Pbar.Filename)
	dirPath := filepath.Join("/tmp/download", sessionInfo.DevId)

	defer cleanUpCollectInfoFile(sessionId, dirPath, filePath)

	ctx.SetHeader("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, sessionInfo.Pbar.Filename))
	ctx.SetHeader("Content-Type", "application/gzip")

	// Serve the file
	if err := ctx.ServeFile(filePath); err != nil {
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("failed to serve file: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	eresult := zmsg.ZsrvSuccess()
	return int(eresult.GetHttpStatusCode()), nil
}

func edgeViewSshHandler(ctx *hutils.Mcontext) (int, interface{}) {
	w := ctx.GetResponseWriter()
	r := ctx.GetRequest()
	_, ok := w.(http.Hijacker)
	if !ok {
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = "webserver doesn't support hijacking"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("webSocket upgrade error: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}
	defer wsConn.Close()

	host := ctx.QueryValue("host")
	port := ctx.QueryValue("port")
	user := ctx.QueryValue("user")
	privateKey := ctx.QueryValue("privateKey")

	fmt.Printf("edgeviewHandler: SSH connection request for host %s, port %s, user %s\n", host, port, user)
	if host == "" || port == "" || user == "" {
		wsConn.WriteMessage(websocket.TextMessage, []byte("invalid parameters: host, port, and user are required"))
		eresult := zmsg.ZsrvBadInput()
		eresult.HttpStatusMsg = "invalid parameters: host, port, and user are required"
		return int(eresult.GetHttpStatusCode()), eresult
	}

	var auths []ssh.AuthMethod

	if privateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(privateKey))
		if err != nil {
			wsConn.WriteMessage(websocket.TextMessage, []byte("invalid private key"))
			eresult := zmsg.ZsrvBadInput()
			eresult.HttpStatusMsg = "invalid private key"
			return int(eresult.GetHttpStatusCode()), eresult
		}
		auths = append(auths, ssh.PublicKeys(signer))
	} else {
		// Ask for password via WebSocket
		wsConn.WriteMessage(websocket.TextMessage, []byte("Password:"))
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			wsConn.WriteMessage(websocket.TextMessage, []byte("failed to read password: "+err.Error()))
			eresult := zmsg.StatusInternalServerError()
			eresult.HttpStatusMsg = "failed to read password from WebSocket"
			return int(eresult.GetHttpStatusCode()), eresult
		}
		password := string(msg)
		auths = append(auths, ssh.Password(password))
	}

	config := &ssh.ClientConfig{
		User:            user,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	client, err := ssh.Dial("tcp", host+":"+port, config)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("ssh connection failed: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("ssh connection failed: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("failed to create ssh session: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("failed to create ssh session: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("failed to get stdin: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("failed to get stdin: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("failed to get stdout: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("failed to get stdout: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("failed to get stderr: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("failed to get stderr: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm", 40, 80, modes); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("request for pseudo terminal failed: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("request for pseudo terminal failed: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	if err := session.Shell(); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte("failed to start shell: "+err.Error()))
		eresult := zmsg.StatusInternalServerError()
		eresult.HttpStatusMsg = fmt.Sprintf("failed to start shell: %v", err)
		return int(eresult.GetHttpStatusCode()), eresult
	}

	go func() { io.Copy(&wsWriter{wsConn}, stdout) }()
	go func() { io.Copy(&wsWriter{wsConn}, stderr) }()

	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			break
		}
		stdin.Write(append(msg, '\n'))
	}

	sresult := zmsg.ZsrvSuccess()
	return int(sresult.GetHttpStatusCode()), sresult
}
