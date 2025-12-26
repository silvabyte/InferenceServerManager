import { join } from "node:path";
import { type Static, t } from "elysia";
import JSON5 from "json5";
import merge from "lodash.merge";
import { Global } from "./global";
import { Log } from "./observability/logger";

export const WorkerConfig = t.Object({
	poolSize: t.Integer({ default: 2 }),
	rotateThreshold: t.Integer({ default: 25 }),
	startingPort: t.Integer({ default: 39000 }),
});

export const WhisperServer = t.Object({
	cmd: t.String({ default: Bun.env.WHISPER_SERVER_CMD ?? "" }),
	cwd: t.String({ default: Bun.env.WHISPER_SERVER_CWD ?? "" }),
});

export const InferenceServerConfig = t.Object({
	editor: t.String(),
	whisperServer: WhisperServer,
	workers: WorkerConfig,
});

export type InferenceServerConfig = Static<typeof InferenceServerConfig>;

export const defaultConfig: InferenceServerConfig = {
	editor: "nvim",
	whisperServer: {
		cmd: Bun.env.WHISPER_SERVER_CMD ?? "",
		cwd: Bun.env.WHISPER_SERVER_CWD ?? "",
	},
	workers: {
		poolSize: 3,
		rotateThreshold: 25,
		startingPort: 39000,
	},
};

async function loadConfig(): Promise<InferenceServerConfig> {
	const path = join(Global.Path.config, "settings.json5");
	const file = Bun.file(path);
	const exists = await file.exists();

	if (!exists) {
		Log.debug({ path }, "Config file not found, creating default");
		await Bun.file(path).write(JSON5.stringify(defaultConfig, null, 2));
		return defaultConfig;
	}

	try {
		const contents = JSON5.parse(await file.text());
		return merge({}, defaultConfig, contents);
	} catch (error) {
		Log.warn({ error, path }, "Failed to parse config, using defaults");
		return defaultConfig;
	}
}

// Load config once at module import
const _config = await loadConfig();

export namespace Config {
	export const config = _config;

	/**
	 * @deprecated Config is loaded automatically at module import.
	 * This function is kept for backward compatibility but does nothing.
	 */
	export async function init() {
		// No-op: config is loaded at module import time
	}

	export function getConfigPath(): string {
		return join(Global.Path.config, "settings.json5");
	}

	export function open(): void {
		const configPath = Config.getConfigPath();
		const editor = _config.editor ?? process.env.EDITOR ?? "xdg-open";
		Bun.spawn([editor, configPath], {
			stdio: ["ignore", "ignore", "ignore"],
		});
	}
}
