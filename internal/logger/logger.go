package logger

import (
	"fmt"
	"time"
)

// Logf prints a log message with timestamp
func Logf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	message := fmt.Sprintf(format, args...)
	fmt.Printf("[%s] %s\n", timestamp, message)
}

// Log prints a log message with timestamp (no formatting)
func Log(message string) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	fmt.Printf("[%s] %s\n", timestamp, message)
}
