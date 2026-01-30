import type { Elysia } from "elysia";
import { t } from "elysia";
import path from "node:path";
import { Global } from "../global";
import {
	FFmpeg,
	type Job,
	JobProcessor,
	JobStore,
	type JobStatus,
} from "../jobs";
import { Log } from "../observability/logger";

const log = Log.child({ module: "jobs-routes" });

// Max file size: 10 GB
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

// Supported formats
const SUPPORTED_VIDEO_FORMATS = ["mp4", "mkv", "webm", "avi", "mov"];
const SUPPORTED_AUDIO_FORMATS = ["wav", "mp3", "m4a", "flac", "ogg", "opus"];
const SUPPORTED_FORMATS = [
	...SUPPORTED_AUDIO_FORMATS,
	...SUPPORTED_VIDEO_FORMATS,
];

// TypeBox Schemas for job routes
const JobSummarySchema = t.Object({
	id: t.String(),
	status: t.String(),
	progress: t.Number(),
	progressMessage: t.Nullable(t.String()),
	originalFilename: t.Nullable(t.String()),
	inputFormat: t.String(),
	fileSizeBytes: t.Number(),
	createdAt: t.String(),
	startedAt: t.Nullable(t.String()),
	completedAt: t.Nullable(t.String()),
});

const JobDetailSchema = t.Object({
	id: t.String(),
	status: t.String(),
	progress: t.Number(),
	progressMessage: t.Nullable(t.String()),
	originalFilename: t.Nullable(t.String()),
	inputFormat: t.String(),
	fileSizeBytes: t.Number(),
	language: t.Nullable(t.String()),
	timestamps: t.Boolean(),
	metadata: t.Nullable(t.Record(t.String(), t.String())),
	result: t.Nullable(t.Any()),
	error: t.Nullable(t.String()),
	createdAt: t.String(),
	startedAt: t.Nullable(t.String()),
	completedAt: t.Nullable(t.String()),
});

const CreateJobResponseSchema = t.Object({
	success: t.Boolean(),
	jobId: t.String(),
	status: t.String(),
	message: t.String(),
});

const JobResponseSchema = t.Object({
	success: t.Boolean(),
	job: JobDetailSchema,
});

const JobStatusResponseSchema = t.Object({
	success: t.Boolean(),
	jobId: t.String(),
	status: t.String(),
	progress: t.Number(),
	progressMessage: t.Nullable(t.String()),
});

const JobListResponseSchema = t.Object({
	success: t.Boolean(),
	jobs: t.Array(JobSummarySchema),
	total: t.Number(),
	limit: t.Number(),
	offset: t.Number(),
});

const ErrorResponseSchema = t.Object({
	success: t.Boolean(),
	error: t.String(),
	code: t.Optional(t.String()),
});

const ProcessorStatusResponseSchema = t.Object({
	success: t.Boolean(),
	processor: t.Object({
		running: t.Boolean(),
		activeJobs: t.Number(),
		queuedJobs: t.Number(),
	}),
});

/**
 * Convert Job to API response format
 */
function jobToResponse(job: Job) {
	return {
		id: job.id,
		status: job.status,
		progress: job.progress,
		progressMessage: job.progressMessage,
		originalFilename: job.originalFilename,
		inputFormat: job.inputFormat,
		fileSizeBytes: job.fileSizeBytes,
		language: job.language,
		timestamps: job.timestamps,
		metadata: job.metadata,
		result: job.result,
		error: job.error,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		completedAt: job.completedAt?.toISOString() ?? null,
	};
}

/**
 * Convert Job to summary format
 */
function jobToSummary(job: Job) {
	return {
		id: job.id,
		status: job.status,
		progress: job.progress,
		progressMessage: job.progressMessage,
		originalFilename: job.originalFilename,
		inputFormat: job.inputFormat,
		fileSizeBytes: job.fileSizeBytes,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		completedAt: job.completedAt?.toISOString() ?? null,
	};
}

/**
 * Register job routes
 */
export function registerJobRoutes(app: Elysia): void {
	app
		// Submit a new job
		.post(
			"/api/v1/jobs",
			async ({ body, set }) => {
				try {
					const formData = body as {
						file: File;
						language?: string;
						timestamps?: string;
						metadata?: string;
					};

					const file = formData.file;
					if (!file) {
						set.status = 400;
						return {
							success: false,
							error: "No file provided",
							code: "MISSING_FILE",
						};
					}

					// Validate file size
					if (file.size > MAX_FILE_SIZE) {
						set.status = 400;
						return {
							success: false,
							error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024 * 1024)} GB`,
							code: "FILE_TOO_LARGE",
						};
					}

					// Get file extension
					const extension = FFmpeg.getExtension(file.name);
					if (!extension) {
						set.status = 400;
						return {
							success: false,
							error: "Could not determine file format",
							code: "UNKNOWN_FORMAT",
						};
					}

					// Validate format
					if (!SUPPORTED_FORMATS.includes(extension)) {
						set.status = 400;
						return {
							success: false,
							error: `Unsupported format: ${extension}. Supported formats: ${SUPPORTED_FORMATS.join(", ")}`,
							code: "UNSUPPORTED_FORMAT",
						};
					}

					// Parse optional fields
					const language = formData.language || undefined;
					const timestamps =
						formData.timestamps !== undefined
							? formData.timestamps === "true"
							: true;
					let metadata: Record<string, string> | undefined;
					if (formData.metadata) {
						try {
							metadata = JSON.parse(formData.metadata);
						} catch {
							set.status = 400;
							return {
								success: false,
								error: "Invalid metadata JSON",
								code: "INVALID_METADATA",
							};
						}
					}

					// Generate unique filename and save to uploads directory
					const timestamp = Date.now();
					const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
					const uploadFilename = `${timestamp}_${safeFilename}`;
					const uploadPath = path.join(Global.Path.uploads, uploadFilename);

					// Write file to disk
					const buffer = await file.arrayBuffer();
					await Bun.write(uploadPath, buffer);

					log.info(
						{
							filename: file.name,
							format: extension,
							size: file.size,
							uploadPath,
						},
						"Saved uploaded file",
					);

					// Create job record
					const job = JobStore.create({
						originalFilename: file.name,
						inputFormat: extension,
						inputPath: uploadPath,
						fileSizeBytes: file.size,
						language,
						timestamps,
						metadata,
					});

					set.status = 202;
					return {
						success: true,
						jobId: job.id,
						status: job.status,
						message: "Job submitted successfully",
					};
				} catch (error) {
					log.error({ error }, "Failed to create job");
					set.status = 500;
					return {
						success: false,
						error: error instanceof Error ? error.message : "Unknown error",
						code: "INTERNAL_ERROR",
					};
				}
			},
			{
				body: t.Object({
					file: t.File(),
					language: t.Optional(t.String()),
					timestamps: t.Optional(t.String()),
					metadata: t.Optional(t.String()),
				}),
				detail: {
					description:
						"Submit a new transcription job. Supports audio and video files up to 10 GB.",
					summary: "Submit a transcription job",
					tags: ["Jobs"],
				},
				response: {
					202: CreateJobResponseSchema,
					400: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		)

		// Get job by ID
		.get(
			"/api/v1/jobs/:id",
			({ params, set }) => {
				const job = JobStore.get(params.id);
				if (!job) {
					set.status = 404;
					return {
						success: false,
						error: "Job not found",
						code: "NOT_FOUND",
					};
				}

				return {
					success: true,
					job: jobToResponse(job),
				};
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				detail: {
					description: "Get detailed information about a transcription job",
					summary: "Get job details",
					tags: ["Jobs"],
				},
				response: {
					200: JobResponseSchema,
					404: ErrorResponseSchema,
				},
			},
		)

		// Get job status (lightweight)
		.get(
			"/api/v1/jobs/:id/status",
			({ params, set }) => {
				const job = JobStore.get(params.id);
				if (!job) {
					set.status = 404;
					return {
						success: false,
						error: "Job not found",
						code: "NOT_FOUND",
					};
				}

				return {
					success: true,
					jobId: job.id,
					status: job.status,
					progress: job.progress,
					progressMessage: job.progressMessage,
				};
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				detail: {
					description:
						"Get lightweight status of a transcription job (for polling)",
					summary: "Get job status",
					tags: ["Jobs"],
				},
				response: {
					200: JobStatusResponseSchema,
					404: ErrorResponseSchema,
				},
			},
		)

		// Cancel job
		.delete(
			"/api/v1/jobs/:id",
			({ params, set }) => {
				const job = JobStore.get(params.id);
				if (!job) {
					set.status = 404;
					return {
						success: false,
						error: "Job not found",
						code: "NOT_FOUND",
					};
				}

				// Only pending jobs can be cancelled
				if (job.status !== "pending") {
					set.status = 400;
					return {
						success: false,
						error: `Cannot cancel job with status: ${job.status}. Only pending jobs can be cancelled.`,
						code: "INVALID_STATE",
					};
				}

				const cancelled = JobStore.cancel(params.id);
				if (!cancelled) {
					set.status = 400;
					return {
						success: false,
						error: "Failed to cancel job",
						code: "CANCEL_FAILED",
					};
				}

				return {
					success: true,
					message: "Job cancelled",
				};
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				detail: {
					description: "Cancel a pending transcription job",
					summary: "Cancel job",
					tags: ["Jobs"],
				},
				response: {
					200: t.Object({
						success: t.Boolean(),
						message: t.String(),
					}),
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
				},
			},
		)

		// List jobs
		.get(
			"/api/v1/jobs",
			({ query }) => {
				const limit = Math.min(Math.max(query.limit || 20, 1), 100);
				const offset = Math.max(query.offset || 0, 0);
				const statusFilter = query.status
					? (query.status.split(",") as JobStatus[])
					: undefined;

				const result = JobStore.list({
					status: statusFilter,
					limit,
					offset,
				});

				return {
					success: true,
					jobs: result.jobs.map(jobToSummary),
					total: result.total,
					limit,
					offset,
				};
			},
			{
				query: t.Object({
					status: t.Optional(t.String()),
					limit: t.Optional(t.Numeric()),
					offset: t.Optional(t.Numeric()),
				}),
				detail: {
					description: "List transcription jobs with optional filtering",
					summary: "List jobs",
					tags: ["Jobs"],
				},
				response: JobListResponseSchema,
			},
		)

		// Get job processor status
		.get(
			"/api/v1/jobs/processor/status",
			() => {
				const status = JobProcessor.getStatus();
				return {
					success: true,
					processor: status,
				};
			},
			{
				detail: {
					description: "Get the status of the background job processor",
					summary: "Get processor status",
					tags: ["Jobs"],
				},
				response: ProcessorStatusResponseSchema,
			},
		);
}
