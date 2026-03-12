import type { Elysia } from "elysia";
import { t } from "elysia";
import { Manager } from "../manager";
import { Log } from "../observability/logger";
import { registerJobRoutes } from "./jobs";
import {
	TranscriptionResultSchema,
	WhisperVerboseResponseSchema,
} from "./schemas";

const log = Log.child({ module: "routes" });

const TranscriptionRequestSchema = t.Object({
	content: t.String({ description: "Base64 encoded audio", minLength: 1 }),
	language: t.Optional(t.String({ description: "Language code (e.g., 'en')" })),
	metadata: t.Optional(t.Record(t.String(), t.String())),
	timestamps: t.Optional(t.Boolean({ default: true })),
});

const TranscriptionResponseSchema = t.Object({
	message: t.Optional(t.String()),
	result: t.Optional(TranscriptionResultSchema),
	success: t.Boolean(),
});

const ErrorResponseSchema = t.Object({
	code: t.Optional(t.String()),
	error: t.String(),
	success: t.Boolean(),
});

const HealthResponseSchema = t.Object({
	pool: t.Optional(
		t.Object({
			healthyWorkers: t.Number(),
			totalWorkers: t.Number(),
		}),
	),
	service: t.String(),
	status: t.String(),
	success: t.Boolean(),
	timestamp: t.String(),
});

const ProviderCapabilitiesSchema = t.Object({
	batch: t.Boolean(),
	diarization: t.Boolean(),
	languages: t.Array(t.String()),
	maxDuration: t.Nullable(t.Number()),
	maxFileSize: t.Nullable(t.Number()),
	streaming: t.Boolean(),
	supportedFormats: t.Array(t.String()),
	wordTimestamps: t.Boolean(),
});

const ProviderInfoSchema = t.Object({
	available: t.Boolean(),
	capabilities: ProviderCapabilitiesSchema,
	costPerMinute: t.Nullable(t.Number()),
	description: t.String(),
	id: t.String(),
	name: t.String(),
	speed: t.Nullable(t.Number()),
});

const ProvidersResponseSchema = t.Object({
	providers: t.Array(ProviderInfoSchema),
	success: t.Boolean(),
});

/**
 * Route registration for Inference Server Manager
 */
export function registerRoutes(app: Elysia): void {
	app
		.get(
			"/health",
			() => {
				const poolStatus = Manager.getPoolStatus();
				return {
					pool: {
						healthyWorkers: poolStatus.healthyWorkers,
						totalWorkers: poolStatus.totalWorkers,
					},
					service: "inference-server-manager",
					status: "healthy",
					success: true,
					timestamp: new Date().toISOString(),
				};
			},
			{
				detail: {
					description:
						"Check if the inference server manager service is healthy",
					summary: "Health check endpoint",
					tags: ["System"],
				},
				response: HealthResponseSchema,
			},
		)

		.get(
			"/api/v1/providers",
			() => {
				const poolStatus = Manager.getPoolStatus();

				return {
					providers: [
						{
							available: poolStatus.healthyWorkers > 0,
							capabilities: {
								batch: true, // Supports batch via job queue
								diarization: false,
								languages: [
									"en",
									"es",
									"fr",
									"de",
									"it",
									"pt",
									"nl",
									"ru",
									"zh",
									"ja",
								],
								maxDuration: null,
								maxFileSize: 10 * 1024 * 1024 * 1024, // 10 GB
								streaming: false,
								supportedFormats: [
									"wav",
									"mp3",
									"m4a",
									"flac",
									"ogg",
									"opus",
									"mp4",
									"mkv",
									"webm",
									"avi",
									"mov",
								],
								wordTimestamps: true,
							},
							costPerMinute: 0.0,
							description:
								"Managed pool of Whisper server workers with load balancing",
							id: "whisper-server",
							name: "Whisper Server",
							speed: null,
						},
					],
					success: true,
				};
			},
			{
				detail: {
					description:
						"Get a list of all available transcription providers and their capabilities",
					summary: "List available transcription providers",
					tags: ["Providers"],
				},
				response: ProvidersResponseSchema,
			},
		)

		.post(
			"/api/v1/transcriptions",
			async ({ body, set }) => {
				try {
					log.info(
						{ language: body.language },
						"Received transcription request",
					);

					const result = await Manager.transcribe(
						body.content,
						body.language,
						body.metadata ?? {},
					);

					return {
						message: "Transcription completed successfully",
						result,
						success: true,
					};
				} catch (error) {
					log.error({ error }, "Transcription request failed");
					set.status = 500;
					return {
						code: "TRANSCRIPTION_ERROR",
						error: error instanceof Error ? error.message : "Unknown error",
						success: false,
					};
				}
			},
			{
				body: TranscriptionRequestSchema,
				detail: {
					description:
						"Submit audio content for synchronous transcription processing",
					summary: "Submit a transcription job",
					tags: ["Transcription"],
				},
				response: {
					200: TranscriptionResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		)

		.post(
			"/api/v1/transcriptions/verbose",
			async ({ body, set }) => {
				try {
					log.info(
						{ language: body.language },
						"Received verbose transcription request",
					);

					const result = await Manager.transcribeRaw(
						body.content,
						body.language,
					);

					return {
						result,
						success: true,
					};
				} catch (error) {
					log.error({ error }, "Verbose transcription request failed");
					set.status = 500;
					return {
						code: "TRANSCRIPTION_ERROR",
						error: error instanceof Error ? error.message : "Unknown error",
						success: false,
					};
				}
			},
			{
				body: t.Object({
					content: t.String({
						description: "Base64 encoded audio",
						minLength: 1,
					}),
					language: t.Optional(
						t.String({ description: "Language code (e.g., 'en')" }),
					),
				}),
				detail: {
					description:
						"Submit audio for transcription and receive the raw whisper verbose_json response including word-level timestamps",
					summary: "Raw verbose transcription",
					tags: ["Transcription"],
				},
				response: {
					200: t.Object({
						result: WhisperVerboseResponseSchema,
						success: t.Boolean(),
					}),
					500: ErrorResponseSchema,
				},
			},
		)

		.get(
			"/api/v1/status",
			() => {
				const poolStatus = Manager.getPoolStatus();
				return poolStatus;
			},
			{
				detail: {
					description: "Get detailed status of all workers in the pool",
					summary: "Get worker pool status",
					tags: ["System"],
				},
			},
		);

	// Register job routes
	registerJobRoutes(app);
}
