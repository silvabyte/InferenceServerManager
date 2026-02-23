import { createWriteStream } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { AppName, Global } from "../global";

export namespace Log {
	const isCompiledBinary = !process.execPath.endsWith("/bun");

	function createLogger() {
		if (isCompiledBinary) {
			// Compiled binary: pino transports (worker_threads) can't resolve npm
			// modules. Use pino.multistream for stdout (journalctl) + file output.
			const logFile = join(Global.Path.logs, "log");
			const fileStream = createWriteStream(logFile, { flags: "a" });
			const level = (Bun.env.LOG_LEVEL ?? "info") as pino.Level;
			return pino(
				{ level },
				pino.multistream([
					{ stream: process.stdout, level },
					{ stream: fileStream, level },
				]),
			);
		}
		// Dev mode: use transports for pino-pretty and pino-roll
		const transport = pino.transport({
			level: Bun.env.LOG_LEVEL ?? "info",
			targets: [
				{ target: "pino-pretty" },
				{
					options: {
						file: join(Global.Path.logs, "log"),
						frequency: "hourly",
						mkdir: true,
					},
					target: "pino-roll",
				},
			],
		});
		return pino(transport);
	}

	export const instance = createLogger().child({
		app: AppName,
	});

	export function withTraceContext(traceId?: string, spanId?: string) {
		return instance.child({
			span_id: spanId,
			trace_id: traceId,
		});
	}

	export const info = instance.info.bind(instance);
	export const debug = instance.debug.bind(instance);
	export const error = instance.error.bind(instance);
	export const warn = instance.warn.bind(instance);
	export const fatal = instance.fatal.bind(instance);
	export const trace = instance.trace.bind(instance);
	export const child = instance.child.bind(instance);
	export const level = instance.level;
}
