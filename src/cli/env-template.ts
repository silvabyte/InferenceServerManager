export function generateEnvFile(): string {
	return `# Inference Server Manager - Environment Configuration
# This file is loaded by the systemd service.
# Restart the service after editing:
#   systemctl --user restart inference-server-manager

# Required: Path to whisper server executable
WHISPER_SERVER_CMD=

# Optional: Working directory for whisper server
# WHISPER_SERVER_CWD=

# Server binding
INFERENCE_SERVER_PORT=3141
INFERENCE_SERVER_HOST=0.0.0.0

# CORS origin (for web UI access)
# CORS_ORIGIN=http://localhost:5173

# Logging level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Ensure ffmpeg and bun are available to the service
# PATH=/usr/local/bin:/usr/bin:/bin
`;
}
