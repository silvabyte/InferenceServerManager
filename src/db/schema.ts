import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Job status enum values
 */
export const JOB_STATUS = {
	PENDING: "pending",
	EXTRACTING_AUDIO: "extracting_audio",
	TRANSCRIBING: "transcribing",
	COMPLETED: "completed",
	FAILED: "failed",
	CANCELLED: "cancelled",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/**
 * Transcription jobs table schema
 */
export const transcriptionJobs = sqliteTable(
	"transcription_jobs",
	{
		// Primary key - nanoid
		id: text("id").primaryKey(),

		// Status tracking
		status: text("status", {
			enum: [
				"pending",
				"extracting_audio",
				"transcribing",
				"completed",
				"failed",
				"cancelled",
			],
		})
			.notNull()
			.default("pending"),

		// Input file info
		originalFilename: text("original_filename"),
		inputFormat: text("input_format").notNull(), // mp4, wav, etc.
		inputPath: text("input_path").notNull(), // Path to uploaded file
		audioPath: text("audio_path"), // Extracted audio path (for video)
		fileSizeBytes: integer("file_size_bytes").notNull(),

		// Transcription options
		language: text("language"),
		timestamps: integer("timestamps", { mode: "boolean" }).default(true),
		metadata: text("metadata", { mode: "json" }).$type<Record<
			string,
			string
		> | null>(),

		// Progress tracking
		progress: integer("progress").default(0), // 0-100
		progressMessage: text("progress_message"),

		// Results
		result: text("result", {
			mode: "json",
		}).$type<TranscriptionResult | null>(),
		verboseResult: text("verbose_result", {
			mode: "json",
		}).$type<WhisperVerboseResponse | null>(),
		error: text("error"),

		// Timestamps (stored as milliseconds)
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		index("idx_status").on(table.status),
		index("idx_created_at").on(table.createdAt),
	],
);

/**
 * Type for a row in the transcription_jobs table
 */
export type TranscriptionJobRow = typeof transcriptionJobs.$inferSelect;

/**
 * Type for inserting into the transcription_jobs table
 */
export type TranscriptionJobInsert = typeof transcriptionJobs.$inferInsert;

/**
 * Transcription result type (mirrored from manager)
 */
export interface TranscriptionSegment {
	text: string;
	start: number;
	end: number;
	confidence: number | null;
	speaker: string | null;
}

export interface TranscriptionResult {
	text: string;
	language: string;
	duration: number;
	segments: TranscriptionSegment[];
	confidence: number;
	provider: string;
	metadata: Record<string, string>;
}

/**
 * Whisper verbose_json word-level timing
 */
export interface WhisperWord {
	word: string;
	start: number;
	end: number;
	t_dtw?: number;
	probability?: number;
}

/**
 * Whisper verbose_json segment
 */
export interface WhisperSegment {
	id: number;
	text: string;
	start: number;
	end: number;
	tokens: number[];
	words?: WhisperWord[];
	temperature?: number;
	avg_logprob?: number;
	no_speech_prob?: number;
	compression_ratio?: number;
	confidence?: number;
	speaker?: string;
}

/**
 * Whisper verbose_json full response
 */
export interface WhisperVerboseResponse {
	task?: string;
	language?: string;
	duration?: number;
	text?: string;
	transcript?: string;
	segments: WhisperSegment[];
	detected_language?: string;
	detected_language_probability?: number;
	language_probabilities?: Record<string, number>;
}
