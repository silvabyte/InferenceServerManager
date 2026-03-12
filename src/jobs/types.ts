import type {
	JOB_STATUS,
	TranscriptionResult,
	TranscriptionSegment,
	WhisperVerboseResponse,
} from "../db/schema";

/**
 * Job status type - matches database enum
 */
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

// Re-export for convenience
export type { TranscriptionResult, TranscriptionSegment };

/**
 * Full job record (returned from store)
 */
export interface Job {
	id: string;
	status: JobStatus;
	originalFilename: string | null;
	inputFormat: string;
	inputPath: string;
	audioPath: string | null;
	fileSizeBytes: number;
	language: string | null;
	timestamps: boolean;
	metadata: Record<string, string> | null;
	progress: number;
	progressMessage: string | null;
	result: TranscriptionResult | null;
	verboseResult: WhisperVerboseResponse | null;
	error: string | null;
	createdAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
}

/**
 * Input for creating a new job
 */
export interface CreateJobInput {
	originalFilename: string;
	inputFormat: string;
	inputPath: string;
	fileSizeBytes: number;
	language?: string;
	timestamps?: boolean;
	metadata?: Record<string, string>;
}

/**
 * Lightweight job status (for polling)
 */
export interface JobStatusInfo {
	jobId: string;
	status: JobStatus;
	progress: number;
	progressMessage: string | null;
}

/**
 * Job listing options
 */
export interface ListJobsOptions {
	status?: JobStatus[];
	limit?: number;
	offset?: number;
}

/**
 * Job listing result
 */
export interface ListJobsResult {
	jobs: Job[];
	total: number;
}
