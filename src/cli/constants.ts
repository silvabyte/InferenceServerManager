import path from "node:path";

export const SERVICE_NAME = "inference-server-manager";
export const ENTRY_POINT = "src/main.ts";
export const XDG_DIR_NAME = "transcription_manager";

export function getProjectRoot(): string {
	// Compiled binary lives at <root>/dist/inference-server-manager
	const execDir = path.dirname(process.execPath);
	if (path.basename(execDir) === "dist") {
		return path.dirname(execDir);
	}
	// Dev mode: running via `bun run src/main.ts`
	return process.cwd();
}

export function getBinaryPath(): string {
	return path.join(getProjectRoot(), "dist", SERVICE_NAME);
}

function getXdgConfigHome(): string {
	return (
		process.env.XDG_CONFIG_HOME || path.join(process.env.HOME ?? "", ".config")
	);
}

export function getEnvFilePath(): string {
	return path.join(getXdgConfigHome(), XDG_DIR_NAME, "env");
}

export function getServiceFilePath(): string {
	return path.join(
		getXdgConfigHome(),
		"systemd",
		"user",
		`${SERVICE_NAME}.service`,
	);
}
