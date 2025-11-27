# EdgeView Client

EdgeView Client is a service that provides a bridge between the EdgeView-Client API endpoints and edge devices. It allows users to execute various commands on Edgeview-UI through a set of HTTP endpoints. The 'client' directory has the core Edgeview-Client implementation.

## Overview

The EdgeView Client service acts as a proxy between users and edge devices, providing functionality to:

- Execute commands on remote devices
- Manage TCP connections to devices
- Download files and collect information from devices
- Monitor command session status and progress
- Fetch command to get the returned reply from device in a asynchronous mode

## API Endpoints

### Command Execution

- **POST /edgeview-command-run** - Main entry point for executing commands on devices
  - Handles different command types (TCP, collectinfo, generic commands, etc.)
  - Supports both synchronous and asynchronous execution

### Session Management

- **GET /edgeview-session-check/id/{session-id}** - Check status of a session
  - Returns connection status for TCP commands
  - Returns file transfer progress for collectinfo commands
  - Returns completion status for generic commands

- **GET /edgeview-session-stop/id/{session-id}** - Stop an active session
  - Terminates TCP connections
  - Cancels ongoing commands

- **GET /edgeview-session-download/id/{session-id}** - Download files generated from commands
  - Used for retrieving files created from collectinfo commands

- **GET /edgeview-session-fetch/id/{session-id}** - Retrieve results from completed async commands
  - Returns the filtered output from command execution

- **GET /edgeview-session-stats** - View statistics about all active sessions and client status

## Command Types

### TCP Commands

TCP commands (prefixed with `tcp/`) establish a persistent connection to a device, mapping a remote port to a local port.

Example: `tcp/192.168.1.10:8080`

### CollectInfo Command

The `collectinfo` command gathers system information from a device and packages it into a downloadable file.

### Generic Commands

Various other commands are supported for device interaction:

- Network diagnostics (ping, trace, etc.)
- System commands (ps, ls, cat, etc.)
- Application management

## Sessions

All commands are executed within a session context. Sessions:

- Have a unique session ID
- Track command execution state
- Allow asynchronous monitoring of long-running operations
- Can be manually terminated

## Authentication

Commands require a valid JWT token that identifies:

- The target device
- The authorized user
- The session's permissions and expiration
- Pass in controller side signing key

## Usage Flow

1. User sends a command request with JWT to `/edgeview-command-run`
2. Edgeview-Client validates the JWT and creates a session
3. Command is executed in Edgeview-Client core
4. User monitors progress via session check endpoint
5. Results are retrieved via fetch or download endpoints
6. Session is automatically cleaned up after completion

## Implementation Notes

- The service manages concurrent sessions using a thread-safe session map
- TCP connections are maintained until explicitly terminated
- Files are temporarily stored in `/tmp/download/{device-uuid}/` and cleaned up after download
- Commands with large outputs can be run asynchronously

## Error Handling

The service provides standardized error responses for:

- Invalid requests or commands
- Authentication failures
- Missing sessions
- Command execution failures
