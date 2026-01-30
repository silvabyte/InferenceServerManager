import { describe, expect, test } from "bun:test";
import { FFmpeg } from "../ffmpeg";

describe("FFmpeg", () => {
	describe("isVideoFormat", () => {
		test("should return true for video formats", () => {
			expect(FFmpeg.isVideoFormat("mp4")).toBe(true);
			expect(FFmpeg.isVideoFormat("mkv")).toBe(true);
			expect(FFmpeg.isVideoFormat("webm")).toBe(true);
			expect(FFmpeg.isVideoFormat("avi")).toBe(true);
			expect(FFmpeg.isVideoFormat("mov")).toBe(true);
			expect(FFmpeg.isVideoFormat("MP4")).toBe(true); // Case insensitive
		});

		test("should return false for audio formats", () => {
			expect(FFmpeg.isVideoFormat("wav")).toBe(false);
			expect(FFmpeg.isVideoFormat("mp3")).toBe(false);
			expect(FFmpeg.isVideoFormat("m4a")).toBe(false);
			expect(FFmpeg.isVideoFormat("flac")).toBe(false);
		});

		test("should return false for unknown formats", () => {
			expect(FFmpeg.isVideoFormat("txt")).toBe(false);
			expect(FFmpeg.isVideoFormat("pdf")).toBe(false);
			expect(FFmpeg.isVideoFormat("")).toBe(false);
		});
	});

	describe("isAudioFormat", () => {
		test("should return true for audio formats", () => {
			expect(FFmpeg.isAudioFormat("wav")).toBe(true);
			expect(FFmpeg.isAudioFormat("mp3")).toBe(true);
			expect(FFmpeg.isAudioFormat("m4a")).toBe(true);
			expect(FFmpeg.isAudioFormat("flac")).toBe(true);
			expect(FFmpeg.isAudioFormat("ogg")).toBe(true);
			expect(FFmpeg.isAudioFormat("opus")).toBe(true);
			expect(FFmpeg.isAudioFormat("WAV")).toBe(true); // Case insensitive
		});

		test("should return false for video formats", () => {
			expect(FFmpeg.isAudioFormat("mp4")).toBe(false);
			expect(FFmpeg.isAudioFormat("mkv")).toBe(false);
			expect(FFmpeg.isAudioFormat("webm")).toBe(false);
		});

		test("should return false for unknown formats", () => {
			expect(FFmpeg.isAudioFormat("txt")).toBe(false);
			expect(FFmpeg.isAudioFormat("pdf")).toBe(false);
			expect(FFmpeg.isAudioFormat("")).toBe(false);
		});
	});

	describe("getExtension", () => {
		test("should return file extension", () => {
			expect(FFmpeg.getExtension("video.mp4")).toBe("mp4");
			expect(FFmpeg.getExtension("audio.wav")).toBe("wav");
			expect(FFmpeg.getExtension("file.with.dots.mkv")).toBe("mkv");
		});

		test("should return lowercase extension", () => {
			expect(FFmpeg.getExtension("VIDEO.MP4")).toBe("mp4");
			expect(FFmpeg.getExtension("Audio.WAV")).toBe("wav");
		});

		test("should return empty string for no extension", () => {
			expect(FFmpeg.getExtension("noextension")).toBe("");
			expect(FFmpeg.getExtension("")).toBe("");
		});
	});

	describe("isAvailable", () => {
		test("should check if FFmpeg is available", async () => {
			// This test depends on the system having FFmpeg installed
			// The result may vary based on the environment
			const available = await FFmpeg.isAvailable();
			expect(typeof available).toBe("boolean");
		});
	});

	// Note: extractAudio and getDuration tests require actual FFmpeg installation
	// and test media files, so they are skipped here. They would be part of
	// integration tests with actual media files.
});
