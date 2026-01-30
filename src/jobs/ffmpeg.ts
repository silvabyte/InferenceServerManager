import { Log } from "../observability/logger";

const log = Log.child({ module: "FFmpeg" });

/**
 * FFmpeg module for video audio extraction
 */
export namespace FFmpeg {
	let isAvailableCache: boolean | null = null;

	/**
	 * Check if FFmpeg is available on the system
	 */
	export async function isAvailable(): Promise<boolean> {
		if (isAvailableCache !== null) {
			return isAvailableCache;
		}

		try {
			const proc = Bun.spawn(["ffmpeg", "-version"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			isAvailableCache = exitCode === 0;

			if (isAvailableCache) {
				log.info("FFmpeg is available");
			} else {
				log.warn("FFmpeg is not available or failed to execute");
			}

			return isAvailableCache;
		} catch (error) {
			log.warn({ error }, "FFmpeg check failed");
			isAvailableCache = false;
			return false;
		}
	}

	/**
	 * Extract audio from video file
	 * Output: 16kHz mono WAV (optimal for Whisper)
	 */
	export async function extractAudio(
		inputPath: string,
		outputPath: string,
	): Promise<void> {
		const available = await isAvailable();
		if (!available) {
			throw new Error("FFmpeg is not available on this system");
		}

		log.info({ inputPath, outputPath }, "Extracting audio from video");

		const args = [
			"-i",
			inputPath,
			"-vn", // No video
			"-acodec",
			"pcm_s16le", // 16-bit PCM
			"-ar",
			"16000", // 16kHz sample rate (optimal for Whisper)
			"-ac",
			"1", // Mono
			"-y", // Overwrite output file
			outputPath,
		];

		const proc = Bun.spawn(["ffmpeg", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		// Capture stderr for error messages
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			log.error({ exitCode, stderr }, "FFmpeg extraction failed");
			throw new Error(`FFmpeg failed with exit code ${exitCode}: ${stderr}`);
		}

		log.info({ outputPath }, "Audio extraction complete");
	}

	/**
	 * Get media duration in seconds
	 */
	export async function getDuration(filePath: string): Promise<number> {
		const available = await isAvailable();
		if (!available) {
			throw new Error("FFmpeg is not available on this system");
		}

		const args = [
			"-i",
			filePath,
			"-show_entries",
			"format=duration",
			"-v",
			"quiet",
			"-of",
			"csv=p=0",
		];

		const proc = Bun.spawn(["ffprobe", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			log.warn({ filePath, exitCode }, "Could not get duration");
			return 0;
		}

		const duration = Number.parseFloat(stdout.trim());
		return Number.isNaN(duration) ? 0 : duration;
	}

	/**
	 * Check if a file is a video format that needs audio extraction
	 */
	export function isVideoFormat(format: string): boolean {
		const videoFormats = ["mp4", "mkv", "webm", "avi", "mov", "m4v", "flv"];
		return videoFormats.includes(format.toLowerCase());
	}

	/**
	 * Check if a file is a supported audio format (can be transcribed directly)
	 */
	export function isAudioFormat(format: string): boolean {
		const audioFormats = ["wav", "mp3", "m4a", "flac", "ogg", "opus", "aac"];
		return audioFormats.includes(format.toLowerCase());
	}

	/**
	 * Get file extension from filename
	 */
	export function getExtension(filename: string): string {
		const parts = filename.split(".");
		if (parts.length < 2) {
			return "";
		}
		return parts[parts.length - 1]?.toLowerCase() ?? "";
	}
}
