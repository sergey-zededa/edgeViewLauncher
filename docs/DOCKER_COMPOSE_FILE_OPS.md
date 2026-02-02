# Docker Compose File Manipulation & Best Practices

## Context & Architecture

Recent analysis of the EdgeView Launcher codebase (specifically `cmd/edgeview-backend/http-server.go` and `internal/session/manager.go`) reveals how shell access for Docker Compose applications is implemented:

1.  **Architecture**: `APP_TYPE_DOCKER_COMPOSE` applications on EVE-OS run inside a dedicated Virtual Machine (App Instance VM).
2.  **Access Method**: The EdgeView backend establishes an SSH tunnel directly to the **App Instance VM** (typically on port 22), not the EVE-OS host itself.
    *   *Code Reference*: `http-server.go`: `// Docker Compose apps usually run in a VM where we can SSH into port 22`
3.  **Capabilities**: Because we are SSHing into a standard Linux VM running Docker, we have access to the standard `docker` CLI and a full shell environment. This is significantly more capable than the restricted EVE-OS `ctr` environment.

## Industry Best Practices for Container Operations

When managing databases or files inside containers, it is best practice **not** to rely on tools like `scp` or `pg_dump` being installed *inside* the container image. Instead, leverage the Docker CLI on the host (the App VM) and standard Unix pipes.

### 1. Database Backups & Restores (Streaming)

The most robust method avoids creating large temporary files on the edge device's disk. Instead, stream the data directly over the SSH connection.

**Prerequisite**: You need the **Local SSH Port** that EdgeView Launcher creates. This is returned by the API but currently abstracted away by the UI.

#### Backup (Dump to local machine)
Run this from your local machine (laptop):

```bash
# Syntax: ssh -p <LocalPort> <user>@127.0.0.1 "docker exec <container> <dump_command>" > local_file.sql

# Example (PostgreSQL):
ssh -p 55780 root@127.0.0.1 "docker exec my-db-container pg_dump -U postgres mydatabase" > backup.sql

# Example (MySQL):
ssh -p 55780 root@127.0.0.1 "docker exec my-db-container mysqldump -u root --password=secret mydatabase" > backup.sql
```

#### Restore (Import from local machine)
Run this from your local machine (laptop):

```bash
# Syntax: cat local_file.sql | ssh -p <LocalPort> <user>@127.0.0.1 "docker exec -i <container> <restore_command>"

# Example (PostgreSQL):
cat backup.sql | ssh -p 55780 root@127.0.0.1 "docker exec -i my-db-container psql -U postgres mydatabase"
```

### 2. File Transfer

If you need to copy specific configuration files or logs in/out of a container:

#### Copy Local File -> Container
This is a two-step process:
1.  `scp` the file to the App VM's temporary directory.
2.  Use `docker cp` on the App VM to move it into the container.

```bash
# Step 1: Upload to App VM
scp -P 55780 ./config.json root@127.0.0.1:/tmp/config.json

# Step 2: Move into Container
ssh -p 55780 root@127.0.0.1 "docker cp /tmp/config.json my-app-container:/app/config/config.json"

# Step 3: Cleanup (Optional)
ssh -p 55780 root@127.0.0.1 "rm /tmp/config.json"
```

#### Copy Container File -> Local
Reverse the process:

```bash
# Step 1: Copy out of container to App VM
ssh -p 55780 root@127.0.0.1 "docker cp my-app-container:/app/logs/app.log /tmp/app.log"

# Step 2: Download from App VM
scp -P 55780 root@127.0.0.1:/tmp/app.log ./app.log
```

## Recommendations for EdgeView Launcher

To facilitate these tasks for the user without requiring them to memorize the commands above, we propose the following improvements:

### Proposal A: UI Enhancements (Low Effort / High Value)

1.  **Expose Local Port**: Display the local SSH port (e.g., `55780`) prominently in the Terminal UI header.
2.  **"Cheatsheet" / Snippets**: Add a "Help" or "Snippets" button in the Terminal view. Clicking it opens a modal showing pre-generated commands for the current session:
    *   *Connect via external terminal*: `ssh -p <port> root@127.0.0.1`
    *   *Docker Exec*: `ssh -p <port> root@127.0.0.1 "docker exec -it <container> /bin/sh"`
    *   *File Upload/Download templates*.

### Proposal B: Native File Manager (Feature)

Implement a dedicated "File Manager" view for Docker Compose apps that wraps the commands above behind a GUI.

1.  **Backend (`cmd/edgeview-backend`)**:
    *   Add `GET /api/fs/ls?path=...`: Wraps `ssh ... "ls -F ..."`
    *   Add `POST /api/fs/upload`: Accepts file -> SFTP to VM -> `docker cp`.
    *   Add `GET /api/fs/download`: `docker cp` -> SFTP from VM -> Stream to client.
2.  **Frontend**:
    *   Simple file browser interface.

### Conclusion

The current architecture is well-suited for these advanced tasks because it provides direct SSH access to the Docker host VM. The primary gap is simply **user education** and **exposing the connection details** (specifically the local proxy port) so users can leverage standard industry tools (`ssh`, `scp`, `docker`) from their own environments.
