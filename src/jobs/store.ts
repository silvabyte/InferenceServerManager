import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
	DB,
	JOB_STATUS,
	type TranscriptionResult,
	transcriptionJobs,
} from "../db";
import { Log } from "../observability/logger";
import type {
	CreateJobInput,
	Job,
	JobStatus,
	ListJobsOptions,
	ListJobsResult,
} from "./types";

const log = Log.child({ module: "JobStore" });

/**
 * Convert database row to Job type
 */
function rowToJob(row: typeof transcriptionJobs.$inferSelect): Job {
	return {
		id: row.id,
		status: row.status as JobStatus,
		originalFilename: row.originalFilename,
		inputFormat: row.inputFormat,
		inputPath: row.inputPath,
		audioPath: row.audioPath,
		fileSizeBytes: row.fileSizeBytes,
		language: row.language,
		timestamps: row.timestamps ?? true,
		metadata: row.metadata as Record<string, string> | null,
		progress: row.progress ?? 0,
		progressMessage: row.progressMessage,
		result: row.result as TranscriptionResult | null,
		error: row.error,
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
	};
}

/**
 * Job store module for CRUD operations on transcription jobs
 */
export namespace JobStore {
	/**
	 * Create a new job record
	 */
	export function create(input: CreateJobInput): Job {
		const db = DB.get();
		const id = nanoid();
		const now = new Date();

		const jobData = {
			id,
			status: "pending" as const,
			originalFilename: input.originalFilename,
			inputFormat: input.inputFormat,
			inputPath: input.inputPath,
			fileSizeBytes: input.fileSizeBytes,
			language: input.language ?? null,
			timestamps: input.timestamps ?? true,
			metadata: input.metadata ?? null,
			progress: 0,
			progressMessage: null,
			result: null,
			error: null,
			createdAt: now,
			startedAt: null,
			completedAt: null,
		};

		db.insert(transcriptionJobs).values(jobData).run();

		log.info(
			{ jobId: id, inputFormat: input.inputFormat, size: input.fileSizeBytes },
			"Created job",
		);

		return {
			...jobData,
			audioPath: null,
		};
	}

	/**
	 * Get job by ID (returns null if not found)
	 */
	export function get(id: string): Job | null {
		const db = DB.get();
		const row = db
			.select()
			.from(transcriptionJobs)
			.where(eq(transcriptionJobs.id, id))
			.get();

		if (!row) {
			return null;
		}

		return rowToJob(row);
	}

	/**
	 * List jobs with optional filters and pagination
	 */
	export function list(options?: ListJobsOptions): ListJobsResult {
		const db = DB.get();
		const limit = options?.limit ?? 20;
		const offset = options?.offset ?? 0;

		// Build where clause
		const conditions = [];
		if (options?.status && options.status.length > 0) {
			conditions.push(inArray(transcriptionJobs.status, options.status));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		// Get total count
		const totalResult = db
			.select({ count: count() })
			.from(transcriptionJobs)
			.where(whereClause)
			.get();
		const total = totalResult?.count ?? 0;

		// Get jobs
		const rows = db
			.select()
			.from(transcriptionJobs)
			.where(whereClause)
			.orderBy(desc(transcriptionJobs.createdAt))
			.limit(limit)
			.offset(offset)
			.all();

		return {
			jobs: rows.map(rowToJob),
			total,
		};
	}

	/**
	 * Get next pending jobs (up to limit)
	 */
	export function getPending(limit: number): Job[] {
		const db = DB.get();
		const rows = db
			.select()
			.from(transcriptionJobs)
			.where(eq(transcriptionJobs.status, JOB_STATUS.PENDING))
			.orderBy(transcriptionJobs.createdAt)
			.limit(limit)
			.all();

		return rows.map(rowToJob);
	}

	/**
	 * Update job status and progress
	 */
	export function updateStatus(
		id: string,
		status: JobStatus,
		progress?: number,
		progressMessage?: string,
	): void {
		const db = DB.get();
		const updates: Partial<typeof transcriptionJobs.$inferInsert> = {
			status,
		};

		if (progress !== undefined) {
			updates.progress = progress;
		}
		if (progressMessage !== undefined) {
			updates.progressMessage = progressMessage;
		}

		// Set startedAt when transitioning from pending
		if (
			status === JOB_STATUS.EXTRACTING_AUDIO ||
			status === JOB_STATUS.TRANSCRIBING
		) {
			updates.startedAt = new Date();
		}

		db.update(transcriptionJobs)
			.set(updates)
			.where(eq(transcriptionJobs.id, id))
			.run();

		log.debug({ jobId: id, status, progress }, "Updated job status");
	}

	/**
	 * Set audio path after extraction
	 */
	export function setAudioPath(id: string, audioPath: string): void {
		const db = DB.get();
		db.update(transcriptionJobs)
			.set({ audioPath })
			.where(eq(transcriptionJobs.id, id))
			.run();

		log.debug({ jobId: id, audioPath }, "Set audio path");
	}

	/**
	 * Mark job as completed with result
	 */
	export function complete(id: string, result: TranscriptionResult): void {
		const db = DB.get();
		db.update(transcriptionJobs)
			.set({
				status: JOB_STATUS.COMPLETED,
				progress: 100,
				progressMessage: "Transcription complete",
				result,
				completedAt: new Date(),
			})
			.where(eq(transcriptionJobs.id, id))
			.run();

		log.info({ jobId: id }, "Job completed");
	}

	/**
	 * Mark job as failed with error
	 */
	export function fail(id: string, error: string): void {
		const db = DB.get();
		db.update(transcriptionJobs)
			.set({
				status: JOB_STATUS.FAILED,
				error,
				completedAt: new Date(),
			})
			.where(eq(transcriptionJobs.id, id))
			.run();

		log.error({ jobId: id, error }, "Job failed");
	}

	/**
	 * Cancel a pending job
	 * Returns true if cancelled, false if job was not pending
	 */
	export function cancel(id: string): boolean {
		const db = DB.get();
		// First check if the job is pending
		const job = get(id);
		if (!job || job.status !== JOB_STATUS.PENDING) {
			return false;
		}

		db.update(transcriptionJobs)
			.set({
				status: JOB_STATUS.CANCELLED,
				completedAt: new Date(),
			})
			.where(eq(transcriptionJobs.id, id))
			.run();

		log.info({ jobId: id }, "Job cancelled");
		return true;
	}

	/**
	 * Get jobs older than retention period (for cleanup)
	 */
	export function getExpired(retentionHours: number): Job[] {
		const db = DB.get();
		const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

		const rows = db
			.select()
			.from(transcriptionJobs)
			.where(
				and(
					inArray(transcriptionJobs.status, [
						JOB_STATUS.COMPLETED,
						JOB_STATUS.FAILED,
						JOB_STATUS.CANCELLED,
					]),
					lt(transcriptionJobs.completedAt, cutoff),
				),
			)
			.all();

		return rows.map(rowToJob);
	}

	/**
	 * Delete job record
	 */
	export function remove(id: string): void {
		const db = DB.get();
		db.delete(transcriptionJobs).where(eq(transcriptionJobs.id, id)).run();
		log.debug({ jobId: id }, "Removed job record");
	}

	/**
	 * Get count of jobs by status
	 */
	export function getStats(): Record<string, number> {
		const db = DB.get();
		const rows = db
			.select({
				status: transcriptionJobs.status,
				count: count(),
			})
			.from(transcriptionJobs)
			.groupBy(transcriptionJobs.status)
			.all();

		const stats: Record<string, number> = {};
		for (const row of rows) {
			stats[row.status] = row.count;
		}
		return stats;
	}
}
