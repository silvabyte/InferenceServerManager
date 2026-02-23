# Long-Running Jobs & Video Support for Inference Server Manager

## Overview

Enhance the inference-server-manager to support:
- Long-running transcription jobs (~20+ minute files)
- Video file uploads (MP4, MKV, WebM, etc.) with audio extraction
- Streaming file uploads via multipart (replacing base64)
- Job queue with SQLite persistence and status polling
- 10 GB max file size support

## Architecture

```
Client (multipart) → Elysia API → Save File → Job Queue (SQLite)
                                                    ↓
                                         Job Processor (background)
                                                    ↓
                                         FFmpeg (extract audio from video)
                                                    ↓
                                         Whisper Workers → Store Result
                                                    ↓
Client ← Poll Status ← Job API
```

---

## Tasks

### 1. Add Dependencies

**File**: `package.json`

Add the following dependencies:
```bash
bun add better-sqlite3 drizzle-orm nanoid
bun add -d @types/better-sqlite3 drizzle-kit
```

- `better-sqlite3` - SQLite driver for Bun
- `drizzle-orm` - Type-safe ORM
- `nanoid` - Generate unique job IDs
- `drizzle-kit` - Migration tooling (dev dependency)

---

### 2. Update Global Paths

**File**: `src/global.ts`

Add new paths:
```typescript
uploads: path.join(data, 'uploads'),    // For uploaded files
database: path.join(data, 'jobs.db'),   // SQLite database file
```

Ensure directories are created on startup.

---

### 3. Create Database Layer

**New file**: `src/db/index.ts`

- Initialize SQLite connection using `better-sqlite3`
- Export `db` instance for use throughout app
- Run migrations on startup
- Handle graceful shutdown

**New file**: `src/db/schema.ts`

Create jobs table schema with Drizzle:
```typescript
export const transcriptionJobs = sqliteTable('transcription_jobs', {
  id: text('id').primaryKey(),                    // nanoid
  status: text('status', {
    enum: ['pending', 'extracting_audio', 'transcribing', 'completed', 'failed', 'cancelled']
  }).notNull().default('pending'),

  // Input
  originalFilename: text('original_filename'),
  inputFormat: text('input_format').notNull(),    // mp4, wav, etc.
  inputPath: text('input_path').notNull(),        // Path to uploaded file
  audioPath: text('audio_path'),                  // Extracted audio path (for video)
  fileSizeBytes: integer('file_size_bytes').notNull(),

  // Options
  language: text('language'),
  timestamps: integer('timestamps', { mode: 'boolean' }).default(true),
  metadata: text('metadata', { mode: 'json' }),

  // Progress
  progress: integer('progress').default(0),       // 0-100
  progressMessage: text('progress_message'),

  // Results
  result: text('result', { mode: 'json' }),       // TranscriptionResult
  error: text('error'),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
});
```

Add indexes on `status` and `createdAt` columns.

---

### 4. Create Job Types

**New file**: `src/jobs/types.ts`

Define TypeScript types:
```typescript
export type JobStatus = 'pending' | 'extracting_audio' | 'transcribing' | 'completed' | 'failed' | 'cancelled';

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
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CreateJobInput {
  originalFilename: string;
  inputFormat: string;
  inputPath: string;
  fileSizeBytes: number;
  language?: string;
  timestamps?: boolean;
  metadata?: Record<string, string>;
}
```

---

### 5. Create Job Store Module

**New file**: `src/jobs/store.ts`

Implement CRUD operations:

```typescript
export namespace JobStore {
  // Create a new job record
  export function create(input: CreateJobInput): Job;

  // Get job by ID (returns null if not found)
  export function get(id: string): Job | null;

  // List jobs with optional filters and pagination
  export function list(options?: {
    status?: JobStatus[];
    limit?: number;
    offset?: number;
  }): { jobs: Job[]; total: number };

  // Get next pending jobs (up to limit)
  export function getPending(limit: number): Job[];

  // Update job status and progress
  export function updateStatus(
    id: string,
    status: JobStatus,
    progress?: number,
    progressMessage?: string
  ): void;

  // Set audio path after extraction
  export function setAudioPath(id: string, audioPath: string): void;

  // Mark job as completed with result
  export function complete(id: string, result: TranscriptionResult): void;

  // Mark job as failed with error
  export function fail(id: string, error: string): void;

  // Cancel a pending job
  export function cancel(id: string): boolean;

  // Get jobs older than retention period (for cleanup)
  export function getExpired(retentionHours: number): Job[];

  // Delete job record
  export function remove(id: string): void;
}
```

---

### 6. Create FFmpeg Module

**New file**: `src/jobs/ffmpeg.ts`

Implement audio extraction from video files:

```typescript
export namespace FFmpeg {
  // Check if FFmpeg is available
  export async function isAvailable(): Promise<boolean>;

  // Extract audio from video file
  // Output: 16kHz mono WAV (optimal for Whisper)
  export async function extractAudio(
    inputPath: string,
    outputPath: string
  ): Promise<void>;

  // Get media duration in seconds
  export async function getDuration(filePath: string): Promise<number>;
}
```

FFmpeg command for extraction:
```bash
ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 -y output.wav
```

Use Bun's subprocess API (`Bun.spawn`) to execute FFmpeg commands.

---

### 7. Create Job Processor

**New file**: `src/jobs/processor.ts`

Background job processor:

```typescript
export namespace JobProcessor {
  // Start the processor (call on app startup)
  export function start(): void;

  // Stop the processor (call on shutdown)
  export function stop(): void;

  // Get processor status
  export function getStatus(): {
    running: boolean;
    activeJobs: number;
    queuedJobs: number;
  };
}
```

Implementation details:
- Poll for pending jobs every 1 second
- Process up to N jobs concurrently (match worker pool size)
- Job processing flow:
  1. Mark job as `extracting_audio` (if video)
  2. Extract audio using FFmpeg (if video format)
  3. Mark job as `transcribing`
  4. Send audio to Manager.transcribe()
  5. Mark job as `completed` with result
- Handle errors: mark as `failed` with error message
- Don't process cancelled jobs

---

### 8. Create Cleanup Task

**New file**: `src/jobs/cleanup.ts`

Periodic cleanup of old job files:

```typescript
export namespace Cleanup {
  // Start cleanup task (runs every hour)
  export function start(): void;

  // Stop cleanup task
  export function stop(): void;

  // Run cleanup immediately (for testing)
  export function runNow(): Promise<number>; // Returns deleted count
}
```

Cleanup logic:
- Find completed/failed jobs older than `retentionHours` (default: 24)
- Delete uploaded files and extracted audio
- Delete job records from database
- Log cleanup results

---

### 9. Create Job Routes

**New file**: `src/routes/jobs.ts`

Implement job API endpoints:

#### POST `/api/v1/jobs` - Submit Job

Request: `multipart/form-data`
- `file` (required): Audio or video file
- `language` (optional): Language code
- `timestamps` (optional): Boolean string
- `metadata` (optional): JSON string

Response (202 Accepted):
```json
{
  "success": true,
  "jobId": "abc123",
  "status": "pending",
  "message": "Job submitted successfully"
}
```

Validation:
- Check file size (max 10 GB)
- Check file extension is supported
- Save file to uploads directory
- Create job record

#### GET `/api/v1/jobs/:id` - Get Job

Response (200 OK):
```json
{
  "success": true,
  "job": {
    "id": "abc123",
    "status": "completed",
    "progress": 100,
    "result": { /* TranscriptionResult */ },
    "createdAt": "2024-01-15T10:00:00Z",
    "completedAt": "2024-01-15T10:05:00Z"
  }
}
```

#### GET `/api/v1/jobs/:id/status` - Get Status (Lightweight)

Response (200 OK):
```json
{
  "success": true,
  "jobId": "abc123",
  "status": "transcribing",
  "progress": 45,
  "progressMessage": "Transcribing audio..."
}
```

#### DELETE `/api/v1/jobs/:id` - Cancel Job

Response (200 OK):
```json
{
  "success": true,
  "message": "Job cancelled"
}
```

Only pending jobs can be cancelled. Return 400 for in-progress jobs.

#### GET `/api/v1/jobs` - List Jobs

Query params:
- `status` (optional): Filter by status
- `limit` (optional): Page size (default 20, max 100)
- `offset` (optional): Pagination offset

Response (200 OK):
```json
{
  "success": true,
  "jobs": [ /* Job summaries */ ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

### 10. Update Configuration

**File**: `src/config.ts`

Add job configuration:

```typescript
export const JobsConfig = t.Object({
  maxFileSizeMb: t.Integer({ default: 10240 }),  // 10 GB
  supportedVideoFormats: t.Array(t.String(), {
    default: ['mp4', 'mkv', 'webm', 'avi', 'mov']
  }),
  supportedAudioFormats: t.Array(t.String(), {
    default: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus']
  }),
  retentionHours: t.Integer({ default: 24 }),
  processorIntervalMs: t.Integer({ default: 1000 }),
});

// Add to InferenceServerConfig
jobs: JobsConfig,
```

---

### 11. Update Routes Index

**File**: `src/routes/index.ts`

- Import and register job routes
- Update provider capabilities to include video formats:
  ```typescript
  supportedFormats: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'mp4', 'mkv', 'webm', 'avi', 'mov'],
  batch: true,  // Now supports batch via jobs
  ```

---

### 12. Update App Startup

**File**: `src/index.ts`

Add initialization sequence:
1. Initialize database connection
2. Run migrations
3. Start job processor
4. Start cleanup task
5. Register shutdown handlers to stop processor/cleanup

---

### 13. Create Module Index

**New file**: `src/jobs/index.ts`

Export all job-related modules:
```typescript
export * from './types';
export * from './store';
export * from './processor';
export * from './ffmpeg';
export * from './cleanup';
```

---

## Testing

### Unit Tests

**New file**: `src/jobs/store.test.ts`
- Test CRUD operations
- Test pagination and filtering
- Test status transitions
- Test expired job queries

**New file**: `src/jobs/ffmpeg.test.ts`
- Test audio extraction from sample video
- Test duration detection
- Test error handling for invalid files

**New file**: `src/jobs/processor.test.ts`
- Test job pickup and processing
- Test concurrent job limits
- Test error handling and failure marking
- Test cancellation handling

### Integration Tests

**New file**: `src/routes/jobs.test.ts`
- Test file upload endpoint
- Test job status polling
- Test job completion flow
- Test cancellation
- Test listing with filters
- Test file size validation
- Test unsupported format rejection

### End-to-End Test

**New file**: `tests/e2e/long-running-job.test.ts`
- Submit a real MP4 video file
- Poll until completion
- Verify transcription result
- Test with ~1 minute sample video

---

## Documentation

### Update README

**File**: `README.md`

Add documentation for:
- New job submission API
- Supported video formats
- Status polling pattern
- Configuration options
- FFmpeg dependency requirement

### API Documentation

Ensure OpenAPI/Swagger docs are updated:
- All new endpoints documented
- Request/response schemas defined
- Error responses documented

---

## Quality Assurance

### Type Checking

Run `bun run typecheck` to verify no type errors.

### Linting

Run `bun run lint` to check code style.

### Format

Run `bun run fmt` to format code.

---

## Final Steps

### 1. Verify All Tests Pass

```bash
bun test
```

### 2. Run Type Check

```bash
bun run typecheck
```

### 3. Run Linting

```bash
bun run lint
```

### 4. Manual Testing

1. Start the server: `bun run dev`
2. Submit a test MP4 file via curl:
   ```bash
   curl -X POST http://localhost:3141/api/v1/jobs \
     -F "file=@test-video.mp4" \
     -F "language=en"
   ```
3. Poll status until complete
4. Verify result contains transcription

### 5. Commit Changes

Once all tests pass and manual testing is complete:

```bash
git add -A
git commit -m "feat(inference-server-manager): add long-running job support and video uploads

- Add SQLite-backed job queue with status tracking
- Support multipart file uploads up to 10GB
- Add FFmpeg audio extraction for video files (mp4, mkv, webm, avi, mov)
- Add background job processor with concurrent processing
- Add job status polling and cancellation endpoints
- Add automatic cleanup of old job files
- Keep existing sync API for backward compatibility"
```

---

## Files Summary

### New Files
- `src/db/index.ts` - Database initialization
- `src/db/schema.ts` - Drizzle schema
- `src/jobs/index.ts` - Module exports
- `src/jobs/types.ts` - Type definitions
- `src/jobs/store.ts` - Job CRUD operations
- `src/jobs/processor.ts` - Background processor
- `src/jobs/ffmpeg.ts` - Video audio extraction
- `src/jobs/cleanup.ts` - File cleanup task
- `src/routes/jobs.ts` - Job API routes
- `src/jobs/store.test.ts` - Store unit tests
- `src/jobs/ffmpeg.test.ts` - FFmpeg unit tests
- `src/jobs/processor.test.ts` - Processor unit tests
- `src/routes/jobs.test.ts` - API integration tests
- `tests/e2e/long-running-job.test.ts` - E2E test

### Modified Files
- `package.json` - Add dependencies
- `src/global.ts` - Add paths
- `src/config.ts` - Add job config
- `src/index.ts` - Initialize jobs on startup
- `src/routes/index.ts` - Register job routes, update capabilities
- `README.md` - Add documentation
