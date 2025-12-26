import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Global } from "../global";

/**
 * Per-worker log file writer.
 * Writes worker stdout/stderr to separate log files instead of polluting the main console.
 * Log files are stored at: Global.Path.logs/workers/worker-{port}.log
 */

const workersLogDir = join(Global.Path.logs, "workers");

// Ensure workers log directory exists
await mkdir(workersLogDir, { recursive: true });

// Track active file handles for cleanup
const activeStreams = new Map<number, { cleanup: () => void }>();

function formatTimestamp(): string {
	return new Date().toISOString();
}

function formatLogLine(stream: "stdout" | "stderr", line: string): string {
	return `[${formatTimestamp()}] [${stream}] ${line}\n`;
}

export namespace WorkerLogger {
	/**
	 * Get the log file path for a worker
	 */
	export function getLogPath(port: number): string {
		return join(workersLogDir, `worker-${port}.log`);
	}

	/**
	 * Write a line to the worker's log file
	 */
	export async function write(
		port: number,
		stream: "stdout" | "stderr",
		line: string,
	): Promise<void> {
		const logPath = getLogPath(port);
		const formatted = formatLogLine(stream, line);
		await appendFile(logPath, formatted);
	}

	/**
	 * Create a stream handler for a worker that writes to its log file.
	 * Returns functions to handle stdout and stderr lines.
	 */
	export function createStreamHandlers(port: number): {
		stdout: (line: string) => void;
		stderr: (line: string) => void;
		cleanup: () => void;
	} {
		const logPath = getLogPath(port);
		const buffer: string[] = [];
		let flushTimer: Timer | null = null;
		let isShuttingDown = false;

		// Batch writes for efficiency (flush every 100ms or when buffer is large)
		const flushBuffer = async () => {
			if (buffer.length === 0 || isShuttingDown) return;

			const toWrite = buffer.splice(0, buffer.length).join("");
			try {
				await appendFile(logPath, toWrite);
			} catch (error) {
				// Silently fail - worker logs are best-effort
				console.error(`Failed to write worker log: ${error}`);
			}
		};

		const scheduleFlush = () => {
			if (flushTimer === null && !isShuttingDown) {
				flushTimer = setTimeout(() => {
					flushTimer = null;
					flushBuffer();
				}, 100);
			}
		};

		const addLine = (stream: "stdout" | "stderr", line: string) => {
			if (isShuttingDown) return;
			buffer.push(formatLogLine(stream, line));
			// Flush immediately if buffer is getting large
			if (buffer.length > 50) {
				flushBuffer();
			} else {
				scheduleFlush();
			}
		};

		const cleanup = () => {
			isShuttingDown = true;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			// Final synchronous-ish flush
			if (buffer.length > 0) {
				const toWrite = buffer.splice(0, buffer.length).join("");
				// Use sync write for cleanup to ensure we don't lose logs
				Bun.write(logPath, toWrite);
			}
			activeStreams.delete(port);
		};

		activeStreams.set(port, { cleanup });

		return {
			stdout: (line: string) => addLine("stdout", line),
			stderr: (line: string) => addLine("stderr", line),
			cleanup,
		};
	}

	/**
	 * Clean up all active worker loggers
	 */
	export function disposeAll(): void {
		for (const [_port, { cleanup }] of activeStreams) {
			cleanup();
		}
		activeStreams.clear();
	}

	/**
	 * Get the workers log directory path
	 */
	export function getLogDir(): string {
		return workersLogDir;
	}
}
