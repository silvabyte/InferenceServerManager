import fs from "node:fs/promises";
import { Log } from "../observability/logger";
import { JobStore } from "./store";

const log = Log.child({ module: "Cleanup" });

/**
 * Periodic cleanup task for old job files
 */
export namespace Cleanup {
	let cleanupInterval: Timer | null = null;

	// Configuration
	const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
	const DEFAULT_RETENTION_HOURS = 24;

	/**
	 * Start the cleanup task
	 */
	export function start(retentionHours = DEFAULT_RETENTION_HOURS): void {
		if (cleanupInterval) {
			log.warn("Cleanup task already running");
			return;
		}

		// Run immediately on startup
		runNow(retentionHours).catch((error) => {
			log.error({ error }, "Initial cleanup failed");
		});

		// Schedule periodic cleanup
		cleanupInterval = setInterval(
			() =>
				runNow(retentionHours).catch((error) => {
					log.error({ error }, "Scheduled cleanup failed");
				}),
			CLEANUP_INTERVAL_MS,
		);

		log.info(
			{ intervalMs: CLEANUP_INTERVAL_MS, retentionHours },
			"Cleanup task started",
		);
	}

	/**
	 * Stop the cleanup task
	 */
	export function stop(): void {
		if (cleanupInterval) {
			clearInterval(cleanupInterval);
			cleanupInterval = null;
		}
		log.info("Cleanup task stopped");
	}

	/**
	 * Run cleanup immediately
	 * Returns the number of jobs cleaned up
	 */
	export async function runNow(
		retentionHours = DEFAULT_RETENTION_HOURS,
	): Promise<number> {
		log.debug({ retentionHours }, "Running cleanup");

		const expiredJobs = JobStore.getExpired(retentionHours);
		if (expiredJobs.length === 0) {
			log.debug("No expired jobs to clean up");
			return 0;
		}

		log.info({ count: expiredJobs.length }, "Found expired jobs to clean up");

		let cleanedCount = 0;

		for (const job of expiredJobs) {
			try {
				// Delete uploaded file
				if (job.inputPath) {
					await deleteFileIfExists(job.inputPath);
				}

				// Delete extracted audio file (if different from input)
				if (job.audioPath && job.audioPath !== job.inputPath) {
					await deleteFileIfExists(job.audioPath);
				}

				// Delete job record
				JobStore.remove(job.id);
				cleanedCount++;
			} catch (error) {
				log.error({ jobId: job.id, error }, "Failed to clean up job");
			}
		}

		log.info({ cleanedCount, total: expiredJobs.length }, "Cleanup complete");
		return cleanedCount;
	}

	/**
	 * Delete a file if it exists
	 */
	async function deleteFileIfExists(filePath: string): Promise<void> {
		try {
			await fs.unlink(filePath);
			log.debug({ filePath }, "Deleted file");
		} catch (error) {
			// Ignore ENOENT (file not found)
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				log.warn({ filePath, error }, "Failed to delete file");
			}
		}
	}
}
