# Inference Server Manager

A Bun-native HTTP service that manages a pool of [WhisperServer](https://github.com/matsilva/whisper/tree/feat/server-builds) workers for audio transcription. Powers the **voice.audetic.link** API.

## Features

- **Worker Pool Management**: Spawns and manages multiple WhisperServer instances
- **Load Balancing**: Round-robin distribution across healthy workers
- **Health Monitoring**: Automatic health checks every 5 seconds
- **Auto-Recovery**: Respawns failed workers with exponential backoff
- **Worker Recycling**: Rotates workers after configurable request threshold
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

## Quick Start

```bash
# Install dependencies
bun install

# Development (with hot reload)
bun run dev

# Production
bun run start
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

## Deployment

This service powers `voice.audetic.link`. For deployment:

1. Ensure `WHISPER_SERVER_CMD` points to a valid whisper server binary
2. Set `CORS_ORIGIN` to your frontend domain
3. Configure worker pool size based on available resources
4. Use a process manager (systemd, pm2) for production

## Development

```bash
# Type check
bun run typecheck

# Format
bun run fmt

# Lint
bun run lint

# Check (format + lint)
bun run check
```

## License

MIT
