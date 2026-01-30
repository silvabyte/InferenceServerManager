import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";
import { JobStore } from "../store";

// Mock the DB module to use an in-memory database for testing
const testDb = new Database(":memory:");
testDb.exec("PRAGMA journal_mode = WAL");

// Create the table
testDb.exec(`
	CREATE TABLE IF NOT EXISTS transcription_jobs (
		id TEXT PRIMARY KEY,
		status TEXT NOT NULL DEFAULT 'pending',
		original_filename TEXT,
		input_format TEXT NOT NULL,
		input_path TEXT NOT NULL,
		audio_path TEXT,
		file_size_bytes INTEGER NOT NULL,
		language TEXT,
		timestamps INTEGER DEFAULT 1,
		metadata TEXT,
		progress INTEGER DEFAULT 0,
		progress_message TEXT,
		result TEXT,
		error TEXT,
		created_at INTEGER NOT NULL,
		started_at INTEGER,
		completed_at INTEGER
	)
`);

const db = drizzle(testDb, { schema });

// Mock the DB module
const { DB } = await import("../../db");

// Override DB.get to return our test database
DB.get = () => db;
DB.init = () => db;

describe("JobStore", () => {
	beforeEach(() => {
		// Clear all jobs before each test
		testDb.exec("DELETE FROM transcription_jobs");
	});

	afterAll(() => {
		testDb.close();
	});

	describe("create", () => {
		test("should create a new job with default values", () => {
			const job = JobStore.create({
				originalFilename: "test.mp4",
				inputFormat: "mp4",
				inputPath: "/uploads/test.mp4",
				fileSizeBytes: 1024,
			});

			expect(job.id).toBeDefined();
			expect(job.id.length).toBeGreaterThan(0);
			expect(job.status).toBe("pending");
			expect(job.originalFilename).toBe("test.mp4");
			expect(job.inputFormat).toBe("mp4");
			expect(job.inputPath).toBe("/uploads/test.mp4");
			expect(job.fileSizeBytes).toBe(1024);
			expect(job.timestamps).toBe(true);
			expect(job.progress).toBe(0);
			expect(job.createdAt).toBeInstanceOf(Date);
		});

		test("should create a job with custom options", () => {
			const job = JobStore.create({
				originalFilename: "audio.wav",
				inputFormat: "wav",
				inputPath: "/uploads/audio.wav",
				fileSizeBytes: 2048,
				language: "es",
				timestamps: false,
				metadata: { source: "test" },
			});

			expect(job.language).toBe("es");
			expect(job.timestamps).toBe(false);
			expect(job.metadata).toEqual({ source: "test" });
		});
	});

	describe("get", () => {
		test("should return job by ID", () => {
			const created = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 512,
			});

			const retrieved = JobStore.get(created.id);
			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(created.id);
			expect(retrieved?.originalFilename).toBe("test.wav");
		});

		test("should return null for non-existent ID", () => {
			const job = JobStore.get("non-existent-id");
			expect(job).toBeNull();
		});
	});

	describe("list", () => {
		test("should list all jobs", () => {
			JobStore.create({
				originalFilename: "test1.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test1.wav",
				fileSizeBytes: 100,
			});
			JobStore.create({
				originalFilename: "test2.mp4",
				inputFormat: "mp4",
				inputPath: "/uploads/test2.mp4",
				fileSizeBytes: 200,
			});

			const result = JobStore.list();
			expect(result.total).toBe(2);
			expect(result.jobs.length).toBe(2);
		});

		test("should filter by status", () => {
			JobStore.create({
				originalFilename: "pending.wav",
				inputFormat: "wav",
				inputPath: "/uploads/pending.wav",
				fileSizeBytes: 100,
			});
			const job2 = JobStore.create({
				originalFilename: "completed.wav",
				inputFormat: "wav",
				inputPath: "/uploads/completed.wav",
				fileSizeBytes: 200,
			});

			// Complete one job
			JobStore.complete(job2.id, {
				text: "Test",
				language: "en",
				duration: 10,
				segments: [],
				confidence: 1.0,
				provider: "test",
				metadata: {},
			});

			const pendingJobs = JobStore.list({ status: ["pending"] });
			expect(pendingJobs.total).toBe(1);
			expect(pendingJobs.jobs[0]?.status).toBe("pending");

			const completedJobs = JobStore.list({ status: ["completed"] });
			expect(completedJobs.total).toBe(1);
			expect(completedJobs.jobs[0]?.status).toBe("completed");
		});

		test("should paginate results", () => {
			for (let i = 0; i < 5; i++) {
				JobStore.create({
					originalFilename: `test${i}.wav`,
					inputFormat: "wav",
					inputPath: `/uploads/test${i}.wav`,
					fileSizeBytes: i * 100,
				});
			}

			const page1 = JobStore.list({ limit: 2, offset: 0 });
			expect(page1.total).toBe(5);
			expect(page1.jobs.length).toBe(2);

			const page2 = JobStore.list({ limit: 2, offset: 2 });
			expect(page2.total).toBe(5);
			expect(page2.jobs.length).toBe(2);

			const page3 = JobStore.list({ limit: 2, offset: 4 });
			expect(page3.total).toBe(5);
			expect(page3.jobs.length).toBe(1);
		});
	});

	describe("updateStatus", () => {
		test("should update job status and progress", () => {
			const job = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 100,
			});

			JobStore.updateStatus(job.id, "transcribing", 50, "Transcribing...");

			const updated = JobStore.get(job.id);
			expect(updated?.status).toBe("transcribing");
			expect(updated?.progress).toBe(50);
			expect(updated?.progressMessage).toBe("Transcribing...");
			expect(updated?.startedAt).toBeInstanceOf(Date);
		});
	});

	describe("complete", () => {
		test("should mark job as completed with result", () => {
			const job = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 100,
			});

			const result = {
				text: "Hello world",
				language: "en",
				duration: 5.0,
				segments: [{ text: "Hello world", start: 0, end: 5, confidence: 0.95, speaker: null }],
				confidence: 0.95,
				provider: "whisper-server",
				metadata: {},
			};

			JobStore.complete(job.id, result);

			const completed = JobStore.get(job.id);
			expect(completed?.status).toBe("completed");
			expect(completed?.progress).toBe(100);
			expect(completed?.result?.text).toBe("Hello world");
			expect(completed?.completedAt).toBeInstanceOf(Date);
		});
	});

	describe("fail", () => {
		test("should mark job as failed with error", () => {
			const job = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 100,
			});

			JobStore.fail(job.id, "FFmpeg failed");

			const failed = JobStore.get(job.id);
			expect(failed?.status).toBe("failed");
			expect(failed?.error).toBe("FFmpeg failed");
			expect(failed?.completedAt).toBeInstanceOf(Date);
		});
	});

	describe("cancel", () => {
		test("should cancel a pending job", () => {
			const job = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 100,
			});

			const cancelled = JobStore.cancel(job.id);
			expect(cancelled).toBe(true);

			const updated = JobStore.get(job.id);
			expect(updated?.status).toBe("cancelled");
		});

		test("should not cancel non-pending job", () => {
			const job = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 100,
			});

			JobStore.updateStatus(job.id, "transcribing", 50);

			const cancelled = JobStore.cancel(job.id);
			expect(cancelled).toBe(false);

			const updated = JobStore.get(job.id);
			expect(updated?.status).toBe("transcribing");
		});
	});

	describe("getPending", () => {
		test("should return pending jobs in order", () => {
			const job1 = JobStore.create({
				originalFilename: "first.wav",
				inputFormat: "wav",
				inputPath: "/uploads/first.wav",
				fileSizeBytes: 100,
			});

			const job2 = JobStore.create({
				originalFilename: "second.wav",
				inputFormat: "wav",
				inputPath: "/uploads/second.wav",
				fileSizeBytes: 200,
			});

			// Complete the second job
			JobStore.complete(job2.id, {
				text: "Test",
				language: "en",
				duration: 10,
				segments: [],
				confidence: 1.0,
				provider: "test",
				metadata: {},
			});

			const pending = JobStore.getPending(10);
			expect(pending.length).toBe(1);
			expect(pending[0]?.id).toBe(job1.id);
		});
	});

	describe("remove", () => {
		test("should remove job from database", () => {
			const job = JobStore.create({
				originalFilename: "test.wav",
				inputFormat: "wav",
				inputPath: "/uploads/test.wav",
				fileSizeBytes: 100,
			});

			JobStore.remove(job.id);

			const removed = JobStore.get(job.id);
			expect(removed).toBeNull();
		});
	});
});
