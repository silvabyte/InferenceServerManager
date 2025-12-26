import { Log } from "../observability/logger";
import { WorkerLogger } from "../observability/worker-logger";

export enum WorkerState {
	Starting = "starting",
	Healthy = "healthy",
	Unhealthy = "unhealthy",
	Stopped = "stopped",
}

export interface Worker {
	id: string;
	port: number;
	baseUrl: string;
	process: ReturnType<typeof Bun.spawn>;
	state: WorkerState;
	requestCount: number;
	consecutiveFailures: number;
	acceptingRequests: boolean;
	startedAt: number;
	lastHealthyAt: number;
}

// Track worker loggers for cleanup
const workerLoggers = new Map<
	string,
	ReturnType<typeof WorkerLogger.createStreamHandlers>
>();

export namespace Workers {
	const log = Log.child({ module: "Workers" });
	let workerCounter = 0;

	export function buildWorkerArgs(
		port: number,
		model: string,
		threads: number,
		extraArgs: string,
	): string[] {
		const base = ["--port", port.toString()];
		const modelArgs = model ? ["--model", model] : [];
		const threadArgs = threads > 0 ? ["--threads", threads.toString()] : [];
		const extra = extraArgs ? extraArgs.split(" ").filter((a) => a) : [];
		return [...base, ...modelArgs, ...threadArgs, ...extra];
	}

	export function spawn(
		port: number,
		serverCmd: string,
		serverCwd: string,
		model: string,
		threads: number,
		extraArgs: string,
	): Worker {
		const id = `worker_${port}_${Date.now()}_${workerCounter++}`;
		const args = buildWorkerArgs(port, model, threads, extraArgs);

		log.info({ port, workerId: id }, "Spawning worker");

		// Create per-worker log file handler
		const workerLog = WorkerLogger.createStreamHandlers(port);
		workerLoggers.set(id, workerLog);

		try {
			const proc = Bun.spawn([serverCmd, ...args], {
				cwd: serverCwd,
				onExit: (_proc, exitCode, signalCode) => {
					log.info(
						{ exitCode, port, signalCode, workerId: id },
						"Worker exited",
					);
					// Cleanup the worker logger
					const logger = workerLoggers.get(id);
					if (logger) {
						logger.cleanup();
						workerLoggers.delete(id);
					}
				},
				stderr: "pipe",
				stdout: "pipe",
			});

			// Stream stdout to worker log file
			(async () => {
				try {
					const reader = proc.stdout.getReader();
					const decoder = new TextDecoder();
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						const text = decoder.decode(value);
						for (const line of text.split("\n")) {
							if (line.trim()) {
								workerLog.stdout(line);
							}
						}
					}
				} catch (_e) {
					// Stream closed
				}
			})();

			// Stream stderr to worker log file
			(async () => {
				try {
					const reader = proc.stderr.getReader();
					const decoder = new TextDecoder();
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						const text = decoder.decode(value);
						for (const line of text.split("\n")) {
							if (line.trim()) {
								workerLog.stderr(line);
							}
						}
					}
				} catch (_e) {
					// Stream closed
				}
			})();

			const worker: Worker = {
				acceptingRequests: true,
				baseUrl: `http://127.0.0.1:${port}`,
				consecutiveFailures: 0,
				id,
				lastHealthyAt: 0,
				port,
				process: proc,
				requestCount: 0,
				startedAt: Date.now(),
				state: WorkerState.Starting,
			};

			return worker;
		} catch (error) {
			log.error({ error, port, workerId: id }, "Failed to spawn worker");
			// Cleanup logger on spawn failure
			workerLog.cleanup();
			workerLoggers.delete(id);
			throw error;
		}
	}

	export function terminate(worker: Worker, graceful: boolean): void {
		try {
			worker.acceptingRequests = false;
			if (graceful) {
				// Give a moment for in-flight requests
				setTimeout(() => {
					worker.process.kill();
				}, 2000);
			} else {
				worker.process.kill();
			}
			worker.state = WorkerState.Stopped;
			log.info({ port: worker.port, workerId: worker.id }, "Worker terminated");

			// Cleanup the worker logger
			const logger = workerLoggers.get(worker.id);
			if (logger) {
				logger.cleanup();
				workerLoggers.delete(worker.id);
			}
		} catch (error) {
			log.error(
				{ error, port: worker.port, workerId: worker.id },
				"Failed to terminate worker",
			);
		}
	}

	export function isAlive(worker: Worker): boolean {
		return worker.process.exitCode === null;
	}

	/**
	 * Get the log file path for a worker
	 */
	export function getLogPath(port: number): string {
		return WorkerLogger.getLogPath(port);
	}

	/**
	 * Clean up all worker loggers
	 */
	export function disposeAllLoggers(): void {
		WorkerLogger.disposeAll();
		workerLoggers.clear();
	}
}
