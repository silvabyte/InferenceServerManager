# Inference Server Manager

A Bun-native HTTP service that manages a pool of [WhisperServer](https://github.com/matsilva/whisper/tree/feat/server-builds) workers for audio transcription. Powers the **voice.audetic.link** API.

## Features

- **Worker Pool Management**: Spawns and manages multiple WhisperServer instances
- **Load Balancing**: Round-robin distribution across healthy workers
- **Health Monitoring**: Automatic health checks every 5 seconds
- **Auto-Recovery**: Respawns failed workers with exponential backoff
- **Worker Recycling**: Rotates workers after configurable request threshold
- **Long-Running Jobs**: SQLite-backed job queue for large files (up to 10 GB)
- **Video Support**: Automatic audio extraction from video files (MP4, MKV, WebM, AVI, MOV)
- **Job Status Polling**: Track transcription progress for long-running files
- **Automatic Cleanup**: Removes old job files after configurable retention period
- **OpenAPI Documentation**: Auto-generated API docs at `/openapi`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Inference Server Manager                    │
│                      (Elysia HTTP)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Worker 1   │  │  Worker 2   │  │  Worker 3   │  ...    │
│  │ :39000      │  │ :39001      │  │ :39002      │         │
│  │ (whisper)   │  │ (whisper)   │  │ (whisper)   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  Health Checks (5s) │ Audit Sweep (30s) │ Auto-Rotation    │
└─────────────────────────────────────────────────────────────┘
```

### Long-Running Jobs Architecture

For large files (video and long audio), jobs are processed asynchronously:

```
Client (multipart) → Elysia API → Save File → Job Queue (SQLite)
                                                    ↓
                                         Job Processor (background)
                                                    ↓
                                         FFmpeg (extract audio from video)
                                                    ↓
                                         Whisper Workers → Store Result
                                                    ↓
Client ← Poll Status ← Job API
```

## Quick Start

```bash
# Install dependencies
bun install

# Development (with hot reload)
bun run dev

# Production
bun run start
```

## Installation as a Service

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Linux with systemd
- FFmpeg installed and available on PATH

### Build & Install

```bash
# Compile to standalone binary
bun run build

# Install as a systemd user service
./dist/inference-server-manager install

# Edit the environment file (set WHISPER_SERVER_CMD at minimum)
nano ~/.config/transcription_manager/env

# Restart to pick up env changes
systemctl --user restart inference-server-manager
```

### Updating

After pulling new code:

```bash
./dist/inference-server-manager update
```

This recompiles the binary and restarts the service.

### Managing the Service

```bash
# Check status
./dist/inference-server-manager status
# or: systemctl --user status inference-server-manager

# View logs
journalctl --user -u inference-server-manager -f

# Restart
systemctl --user restart inference-server-manager

# Uninstall
./dist/inference-server-manager uninstall
```

## Environment Variables

| Variable                     | Description                          | Default                 |
| ---------------------------- | ------------------------------------ | ----------------------- |
| `INFERENCE_SERVER_PORT`      | HTTP server port                     | `3141`                  |
| `TRANSCRIPTION_MANAGER_PORT` | (Legacy) HTTP server port            | `3141`                  |
| `INFERENCE_SERVER_HOST`      | HTTP server bind address             | `0.0.0.0`               |
| `WHISPER_SERVER_CMD`         | Path to whisper server executable    | Required                |
| `WHISPER_SERVER_CWD`         | Working directory for whisper server | Current dir             |
| `CORS_ORIGIN`                | Allowed CORS origin                  | `http://localhost:5173` |
| `LOG_LEVEL`                  | Pino log level (see below)           | `info`                  |
| `XDG_DIR_NAME`               | XDG directory name for data storage  | `transcription_manager` |

## Logging

### Log Levels

| Level   | Description                                                              |
| ------- | ------------------------------------------------------------------------ |
| `error` | Critical failures only (worker spawn failures, max health check failures) |
| `warn`  | Warnings (low worker count, worker health degradation)                   |
| `info`  | Default. Manager lifecycle events (startup, shutdown, worker ready)       |
| `debug` | Health check details, startup connection attempts, heartbeat metrics     |
| `trace` | Reserved for future use                                                  |

### Worker Logs

Worker subprocess output (stdout/stderr from WhisperServer) is written to separate log files:
```
~/.local/share/transcription_manager/logs/workers/worker-{port}.log
```

This keeps the main console clean while preserving worker output for debugging.

## Configuration

Config file location: `~/.config/transcription_manager/settings.json5` (or custom `XDG_DIR_NAME`)

```json5
{
  // Number of worker processes
  workers: {
    poolSize: 3,
    rotateThreshold: 25, // Requests before worker rotation
    startingPort: 39000,
  },
  // WhisperServer configuration
  whisperServer: {
    cmd: "/path/to/whisper-server",
    cwd: "/path/to/whisper-project",
  },
  // Job queue configuration
  jobs: {
    maxFileSizeMb: 10240,  // 10 GB max file size
    supportedVideoFormats: ["mp4", "mkv", "webm", "avi", "mov"],
    supportedAudioFormats: ["wav", "mp3", "m4a", "flac", "ogg", "opus"],
    retentionHours: 24,     // Delete completed jobs after 24 hours
    processorIntervalMs: 1000,
    maxConcurrentJobs: 2,
  },
  // Editor for config editing
  editor: "nvim",
}
```

## API Endpoints

### Health Check

```
GET /health
```

Returns service health and worker pool status.

### Submit Transcription

```
POST /api/v1/transcriptions
Content-Type: application/json

{
  "content": "<base64-encoded-audio>",
  "language": "en",
  "timestamps": true,
  "metadata": {}
}
```

### List Providers

```
GET /api/v1/providers
```

Returns available transcription providers and capabilities.

### Worker Pool Status

```
GET /api/v1/status
```

Returns detailed status of all workers in the pool.

### Submit Long-Running Job (Async)

For large files or video files, use the job submission API:

```bash
curl -X POST http://localhost:3141/api/v1/jobs \
  -F "file=@video.mp4" \
  -F "language=en" \
  -F "timestamps=true"
```

Response (202 Accepted):
```json
{
  "success": true,
  "jobId": "abc123xyz",
  "status": "pending",
  "message": "Job submitted successfully"
}
```

### Poll Job Status

```
GET /api/v1/jobs/:id/status
```

Response:
```json
{
  "success": true,
  "jobId": "abc123xyz",
  "status": "transcribing",
  "progress": 50,
  "progressMessage": "Transcribing audio..."
}
```

### Get Job Result

```
GET /api/v1/jobs/:id
```

Returns full job details including transcription result when completed.

### Cancel Job

```
DELETE /api/v1/jobs/:id
```

Cancels a pending job. Returns error if job is already in progress.

### List Jobs

```
GET /api/v1/jobs?status=pending,completed&limit=20&offset=0
```

Returns paginated list of jobs with optional status filter.

## System Requirements

For video file processing, FFmpeg must be installed on the system:

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

## Deployment

This service powers `voice.audetic.link`. For production deployment, use the built-in systemd service installer:

```bash
bun run build && ./dist/inference-server-manager install
```

See [Installation as a Service](#installation-as-a-service) for full details. Key steps:

1. Set `WHISPER_SERVER_CMD` in `~/.config/transcription_manager/env`
2. Set `CORS_ORIGIN` to your frontend domain
3. Configure worker pool size in `~/.config/transcription_manager/settings.json5`
4. Install FFmpeg for video file support

## Development

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Format
bun run fmt

# Lint
bun run lint

# Check (format + lint)
bun run check
```

## License

MIT
