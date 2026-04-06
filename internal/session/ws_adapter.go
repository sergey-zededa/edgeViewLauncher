package session

import (
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WSConnAdapter adapts a websocket.Conn to the net.Conn interface
type WSConnAdapter struct {
	*websocket.Conn
	reader io.Reader
	failed bool
	mu     sync.Mutex
}

func NewWSConnAdapter(conn *websocket.Conn) *WSConnAdapter {
	return &WSConnAdapter{
		Conn: conn,
	}
}

func (a *WSConnAdapter) Read(b []byte) (n int, err error) {
	for {
		a.mu.Lock()
		if a.failed {
			a.mu.Unlock()
			return 0, io.EOF
		}
		a.mu.Unlock()

		if a.reader == nil {
			messageType, reader, err := a.Conn.NextReader()
			if err != nil {
				fmt.Printf("WSConnAdapter: NextReader error: %v\n", err)
				a.mu.Lock()
				a.failed = true
				a.mu.Unlock()
				return 0, err
			}
			if messageType != websocket.BinaryMessage && messageType != websocket.TextMessage {
				continue // Skip non-data messages and try next
			}
			a.reader = reader
		}
		n, err = a.reader.Read(b)
		if err == io.EOF {
			a.reader = nil
			continue // Get next message via loop instead of recursion
		}
		if err != nil {
			fmt.Printf("WSConnAdapter: Reader.Read error: %v\n", err)
			a.mu.Lock()
			a.failed = true
			a.mu.Unlock()
		}
		return n, err
	}
}

func (a *WSConnAdapter) Write(b []byte) (n int, err error) {
	err = a.Conn.WriteMessage(websocket.BinaryMessage, b)
	if err != nil {
		return 0, err
	}
	return len(b), nil
}

func (a *WSConnAdapter) Close() error {
	return a.Conn.Close()
}

func (a *WSConnAdapter) LocalAddr() net.Addr {
	return a.Conn.LocalAddr()
}

func (a *WSConnAdapter) RemoteAddr() net.Addr {
	return a.Conn.RemoteAddr()
}

func (a *WSConnAdapter) SetDeadline(t time.Time) error {
	if err := a.Conn.SetReadDeadline(t); err != nil {
		return err
	}
	return a.Conn.SetWriteDeadline(t)
}

func (a *WSConnAdapter) SetReadDeadline(t time.Time) error {
	return a.Conn.SetReadDeadline(t)
}

func (a *WSConnAdapter) SetWriteDeadline(t time.Time) error {
	return a.Conn.SetWriteDeadline(t)
}
