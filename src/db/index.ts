import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Global } from "../global";
import { Log } from "../observability/logger";
import * as schema from "./schema";

const log = Log.child({ module: "db" });

let sqlite: Database | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Database module for job persistence
 */
export namespace DB {
	/**
	 * Initialize the database connection and run migrations
	 */
	export function init(): ReturnType<typeof drizzle<typeof schema>> {
		if (db) {
			return db;
		}

		log.info({ path: Global.Path.database }, "Initializing database");

		// Create SQLite connection using Bun's native driver
		sqlite = new Database(Global.Path.database, { create: true });

		// Enable WAL mode for better concurrent access
		sqlite.exec("PRAGMA journal_mode = WAL");
		sqlite.exec("PRAGMA synchronous = NORMAL");
		sqlite.exec("PRAGMA foreign_keys = ON");

		// Create Drizzle ORM instance
		db = drizzle(sqlite, { schema });

		// Run migrations (create tables if they don't exist)
		runMigrations();

		log.info("Database initialized");
		return db;
	}

	/**
	 * Get the database instance (must call init first)
	 */
	export function get(): ReturnType<typeof drizzle<typeof schema>> {
		if (!db) {
			throw new Error("Database not initialized. Call DB.init() first.");
		}
		return db;
	}

	/**
	 * Close the database connection
	 */
	export function close(): void {
		if (sqlite) {
			log.info("Closing database connection");
			sqlite.close();
			sqlite = null;
			db = null;
		}
	}

	/**
	 * Run database migrations
	 */
	function runMigrations(): void {
		if (!sqlite) {
			throw new Error("SQLite connection not established");
		}

		log.debug("Running database migrations");

		// Create transcription_jobs table
		sqlite.exec(`
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

		// Create indexes
		sqlite.exec(`
			CREATE INDEX IF NOT EXISTS idx_status ON transcription_jobs(status)
		`);
		sqlite.exec(`
			CREATE INDEX IF NOT EXISTS idx_created_at ON transcription_jobs(created_at)
		`);

		// Migration: add verbose_result column for raw Whisper response
		try {
			sqlite.exec(
				`ALTER TABLE transcription_jobs ADD COLUMN verbose_result TEXT`,
			);
		} catch (_e) {
			// Column already exists — expected on subsequent runs
		}

		log.debug("Database migrations complete");
	}
}

// Re-export schema types
export * from "./schema";
