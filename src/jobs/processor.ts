import path from "node:path";
import { JOB_STATUS } from "../db/schema";
import { Global } from "../global";
import { Manager } from "../manager";
import { Log } from "../observability/logger";
import { FFmpeg } from "./ffmpeg";
import { JobStore } from "./store";
import type { Job } from "./types";

const log = Log.child({ module: "JobProcessor" });

/**
 * Background job processor for handling transcription jobs
 */
export namespace JobProcessor {
	let processorInterval: Timer | null = null;
	let isRunning = false;
	let activeJobs = 0;

	// Configuration
	const POLL_INTERVAL_MS = 1000;
	const MAX_CONCURRENT_JOBS = 2; // Match worker pool size

	/**
	 * Start the job processor
	 */
	export function start(): void {
		if (processorInterval) {
			log.warn("Job processor already running");
			return;
		}

		isRunning = true;
		processorInterval = setInterval(pollForJobs, POLL_INTERVAL_MS);
		log.info(
			{ pollIntervalMs: POLL_INTERVAL_MS, maxConcurrent: MAX_CONCURRENT_JOBS },
			"Job processor started",
		);
	}

	/**
	 * Stop the job processor
	 */
	export function stop(): void {
		if (processorInterval) {
			clearInterval(processorInterval);
			processorInterval = null;
		}
		isRunning = false;
		log.info("Job processor stopped");
	}

	/**
	 * Get processor status
	 */
	export function getStatus(): {
		running: boolean;
		activeJobs: number;
		queuedJobs: number;
	} {
		const stats = JobStore.getStats();
		const queuedJobs = stats[JOB_STATUS.PENDING] ?? 0;

		return {
			running: isRunning,
			activeJobs,
			queuedJobs,
		};
	}

	/**
	 * Poll for pending jobs and process them
	 */
	async function pollForJobs(): Promise<void> {
		if (!isRunning) return;

		// Check if we can take more jobs
		const availableSlots = MAX_CONCURRENT_JOBS - activeJobs;
		if (availableSlots <= 0) {
			return;
		}

		// Get pending jobs
		const pendingJobs = JobStore.getPending(availableSlots);
		if (pendingJobs.length === 0) {
			return;
		}

		log.debug({ count: pendingJobs.length }, "Found pending jobs");

		// Process each job concurrently
		for (const job of pendingJobs) {
			// Skip if job was cancelled while we were fetching
			const currentJob = JobStore.get(job.id);
			if (!currentJob || currentJob.status === JOB_STATUS.CANCELLED) {
				continue;
			}

			activeJobs++;
			processJob(job)
				.catch((error) => {
					log.error(
						{ jobId: job.id, error },
						"Unhandled error in job processing",
					);
				})
				.finally(() => {
					activeJobs--;
				});
		}
	}

	/**
	 * Process a single job
	 */
	async function processJob(job: Job): Promise<void> {
		log.info(
			{
				jobId: job.id,
				inputFormat: job.inputFormat,
				fileSizeBytes: job.fileSizeBytes,
			},
			"Processing job",
		);

		try {
			let audioPath = job.inputPath;

			// Check if we need to extract audio from video
			if (FFmpeg.isVideoFormat(job.inputFormat)) {
				audioPath = await extractAudioFromVideo(job);
			}

			// Transcribe the audio
			await transcribeAudio(job, audioPath);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			JobStore.fail(job.id, errorMessage);
			log.error({ jobId: job.id, error: errorMessage }, "Job failed");
		}
	}

	/**
	 * Extract audio from video file
	 */
	async function extractAudioFromVideo(job: Job): Promise<string> {
		JobStore.updateStatus(
			job.id,
			JOB_STATUS.EXTRACTING_AUDIO,
			10,
			"Extracting audio from video...",
		);

		// Generate output path for extracted audio
		const audioFilename = `${job.id}.wav`;
		const audioPath = path.join(Global.Path.uploads, audioFilename);

		// Check if FFmpeg is available
		const ffmpegAvailable = await FFmpeg.isAvailable();
		if (!ffmpegAvailable) {
			throw new Error(
				"FFmpeg is not available. Install FFmpeg to process video files.",
			);
		}

		// Extract audio
		await FFmpeg.extractAudio(job.inputPath, audioPath);

		// Save audio path to job
		JobStore.setAudioPath(job.id, audioPath);

		JobStore.updateStatus(
			job.id,
			JOB_STATUS.EXTRACTING_AUDIO,
			30,
			"Audio extraction complete",
		);

		return audioPath;
	}

	/**
	 * Transcribe audio file
	 */
	async function transcribeAudio(job: Job, audioPath: string): Promise<void> {
		JobStore.updateStatus(
			job.id,
			JOB_STATUS.TRANSCRIBING,
			40,
			"Transcribing audio...",
		);

		// Read audio file as base64
		const audioFile = Bun.file(audioPath);
		const audioBuffer = await audioFile.arrayBuffer();
		const audioBase64 = Buffer.from(audioBuffer).toString("base64");

		JobStore.updateStatus(
			job.id,
			JOB_STATUS.TRANSCRIBING,
			50,
			"Sending to transcription service...",
		);

		// Single Whisper call — get raw verbose_json
		const raw = await Manager.transcribeRaw(
			audioBase64,
			job.language ?? undefined,
		);

		// Derive normalized result from raw response (pure function, no network call)
		const result = Manager.parseTranscription(
			raw,
			job.language ?? undefined,
			job.metadata ?? {},
		);

		JobStore.updateStatus(
			job.id,
			JOB_STATUS.TRANSCRIBING,
			90,
			"Finalizing transcription...",
		);

		// Store both normalized and raw results
		JobStore.complete(job.id, result, raw);
	}
}
