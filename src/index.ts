import type { Elysia } from "elysia";
import { createApp } from "./app";
import { Config } from "./config";
import { DB } from "./db";
import { Cleanup, JobProcessor } from "./jobs";
import { Observability } from "./observability";
import { Log } from "./observability/logger";

let registered = false;
let app: Elysia | null = null;
let isCleaningUp = false;

const WithTry = async <T>(fn: () => Promise<T>, msg = "") => {
	try {
		const resultsIfAny = await fn();
		return resultsIfAny;
	} catch (error) {
		Log.error(error, msg);
	}
};

const cleanup = async () => {
	// Prevent double cleanup
	if (isCleaningUp) {
		return;
	}
	isCleaningUp = true;

	Log.info("Shutting down Inference Server Manager...");

	// Stop job processor
	WithTry(async () => {
		JobProcessor.stop();
	}, "Failed to stop job processor");

	// Stop cleanup task
	WithTry(async () => {
		Cleanup.stop();
	}, "Failed to stop cleanup task");

	// Dispose manager and workers
	WithTry(async () => {
		const { Manager } = await import("./manager");
		await Manager.dispose();
	}, "Failed to dispose manager");

	// Close database connection
	WithTry(async () => {
		DB.close();
	}, "Failed to close database");

	// End observability session
	WithTry(
		async () => Observability.dispose(),
		"Failed to end observability session",
	);

	if (app?.server) {
		try {
			await app.stop();
		} catch (error) {
			// Ignore errors if server isn't running
			Log.debug({ error }, "Server already stopped or not running");
		}
	}

	Log.info("Inference Server Manager shutdown complete");
};

const registerShutdown = () => {
	if (registered) {
		return;
	}

	registered = true;

	const handleSignal = async (signal: NodeJS.Signals) => {
		Log.info({ signal }, "Received shutdown signal");
		await cleanup();
		const exitCode = signal === "SIGINT" ? 130 : 143;
		process.exit(exitCode);
	};

	process.once("SIGINT", handleSignal);
	process.once("SIGTERM", handleSignal);
};

namespace Main {
	export const run = async () => {
		registerShutdown();

		// Config is loaded at module import, no need to call init()

		// Start observability session (heartbeat pulse)
		Observability.start();

		// Initialize the database
		DB.init();

		// Initialize the inference server manager with worker pool
		const { Manager } = await import("./manager");
		await Manager.init();

		// Start job processor
		JobProcessor.start();

		// Start cleanup task
		const retentionHours = Config.config.jobs?.retentionHours ?? 24;
		Cleanup.start(retentionHours);

		try {
			app = createApp();

			// Support both old and new env var names for backward compatibility
			const port = Number(
				Bun.env.INFERENCE_SERVER_PORT ??
					Bun.env.TRANSCRIPTION_MANAGER_PORT ??
					3141,
			);
			// Bind to 0.0.0.0 to accept connections from any host
			const hostname = Bun.env.INFERENCE_SERVER_HOST ?? "0.0.0.0";
			app.listen({ port, hostname });

			Log.info(
				{ hostname: app.server?.hostname, port: app.server?.port },
				"Server started",
			);

			// Note: Cleanup is handled by signal handlers (SIGINT/SIGTERM)
		} catch (error) {
			Log.error(error, "Failed to start Inference Server Manager");
			await cleanup();
			throw error;
		}
	};
}

Main.run().catch((error) => {
	console.error("Inference Server Manager failed to start", error);
	process.exitCode = 1;
});
