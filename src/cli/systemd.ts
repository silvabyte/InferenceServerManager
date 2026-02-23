export function generateServiceFile(opts: {
	binaryPath: string;
	envFilePath: string;
}): string {
	return `[Unit]
Description=Inference Server Manager - Whisper worker pool and transcription API
After=network.target

[Service]
Type=simple
ExecStart=${opts.binaryPath}
EnvironmentFile=${opts.envFilePath}
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=inference-server-manager

[Install]
WantedBy=default.target
`;
}
