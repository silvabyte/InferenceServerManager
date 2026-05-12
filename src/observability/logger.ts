import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { Axiom as AxiomClient } from "@axiomhq/js";
import pino from "pino";
import { AppName, Global } from "../global";
import { Axiom } from "./axiom";

export namespace Log {
	const isCompiledBinary = !process.execPath.endsWith("/bun");

	// Set when Axiom log shipping is configured; flushed by Log.shutdown().
	let axiomClient: AxiomClient | undefined;

	/**
	 * A pino destination stream that forwards each serialized log line to Axiom
	 * via the `@axiomhq/js` client (which batches/flushes in the background).
	 */
	function createAxiomDestination(cfg: Axiom.LogsClientConfig): Writable {
		// Throttle ingest-error noise to at most one line per minute (a bad
		// token would otherwise spam stderr every batch interval).
		let lastErrorAt = 0;
		const client = new AxiomClient({
			onError: (err) => {
				const now = Date.now();
				if (now - lastErrorAt < 60_000) return;
				lastErrorAt = now;
				// Best-effort: never recurse back through Log — just note it on stderr.
				process.stderr.write(
					`[axiom] log ingest error: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			},
			orgId: cfg.orgId,
			token: cfg.token,
			url: cfg.url,
		});
		axiomClient = client;

		const levelLabels = pino.levels.labels;
		return new Writable({
			write(chunk: Buffer | string, _enc, cb) {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				for (const line of text.split("\n")) {
					if (!line) continue;
					try {
						const event = JSON.parse(line) as Record<string, unknown>;
						if (typeof event.time === "number") {
							event._time = new Date(event.time).toISOString();
						}
						if (typeof event.level === "number") {
							event.level_name =
								levelLabels[event.level] ?? String(event.level);
						}
						client.ingest(cfg.dataset, event);
					} catch {
						// Skip anything that isn't a JSON log line.
					}
				}
				cb();
			},
		});
	}

	function createLogger() {
		const level = (Bun.env.LOG_LEVEL ?? "info") as pino.Level;
		const axiomCfg = Axiom.logsClient();
		const axiomStream = axiomCfg ? createAxiomDestination(axiomCfg) : undefined;

		if (isCompiledBinary) {
			// Compiled binary: pino transports (worker_threads) can't resolve npm
			// modules. Use pino.multistream for stdout (journalctl) + file output,
			// plus the Axiom stream when configured.
			const fileStream = createWriteStream(join(Global.Path.logs, "log"), {
				flags: "a",
			});
			const streams: pino.StreamEntry[] = [
				{ level, stream: process.stdout },
				{ level, stream: fileStream },
			];
			if (axiomStream) streams.push({ level, stream: axiomStream });
			return pino({ level }, pino.multistream(streams));
		}

		// Dev mode: use transports for pino-pretty and pino-roll.
		const transport = pino.transport({
			level,
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
		if (!axiomStream) return pino(transport);
		// Fan the same NDJSON out to the transports and to Axiom.
		return pino(
			{ level },
			pino.multistream([
				{ level, stream: transport },
				{ level, stream: axiomStream },
			]),
		);
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

	/** Flush buffered logs (pino + Axiom). Call on shutdown. */
	export async function shutdown(): Promise<void> {
		try {
			(instance as { flush?: () => void }).flush?.();
		} catch {
			// ignore
		}
		if (axiomClient) {
			try {
				await axiomClient.flush();
			} catch {
				// ignore
			}
		}
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
