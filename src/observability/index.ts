import { Log } from "./logger";

/**
 * Observability module for periodic health/status logging.
 * Logs a simplified pulse every 24 hours with essential metrics only.
 */
export namespace Observability {
	let timer: Timer | undefined;

	// Default interval: 24 hours
	const PULSE_INTERVAL_MS = 60_000 * 60 * 24;

	function formatBytes(bytes: number): string {
		const mb = bytes / (1024 * 1024);
		return `${mb.toFixed(1)}MB`;
	}

	function formatUptime(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		return `${minutes}m`;
	}

	function pulse(): void {
		const mem = process.memoryUsage();
		Log.debug(
			{
				heapUsed: formatBytes(mem.heapUsed),
				pid: process.pid,
				rss: formatBytes(mem.rss),
				uptime: formatUptime(process.uptime()),
			},
			"heartbeat",
		);
	}

	export function start(): void {
		// Don't pulse immediately - wait for the interval
		// This prevents flooding logs at startup
		timer = setInterval(pulse, PULSE_INTERVAL_MS);
	}

	export function dispose(): void {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	}
}
