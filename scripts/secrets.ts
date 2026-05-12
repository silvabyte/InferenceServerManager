#!/usr/bin/env bun
// =============================================================================
// Pull secrets from Bitwarden for inference-server-manager
// =============================================================================
// Usage:
//   bun scripts/secrets.ts all              # = local (default)
//   bun scripts/secrets.ts local            # write ./.env from audetic/ism-env-local
//   bun scripts/secrets.ts prod             # write the systemd env file from audetic/ism-env-prod
//
// Pass --debug for verbose logging:
//   bun scripts/secrets.ts local --debug
//
// First-time setup: `bun run secrets:init` (creates the Bitwarden items).
// Mirrors the strategy from silvabyte/weekendgarden's scripts/secrets.ts.
// =============================================================================

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	bwGetItem,
	debug,
	ensureUnlocked,
	error,
	fieldsToEnv,
	info,
	preflight,
	syncVault,
	writeEnvFile,
} from "./lib/bw";

const REPO_ROOT = resolve(import.meta.dir, "..");

// One place that maps a target to its Bitwarden item + destination file.
const TARGETS = {
	local: {
		item: "audetic/ism-env-local",
		dest: join(REPO_ROOT, ".env"),
	},
	prod: {
		item: "audetic/ism-env-prod",
		// Same path the systemd service reads (src/cli/constants.ts getEnvFilePath).
		dest: join(
			process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
			process.env.XDG_DIR_NAME || "transcription_manager",
			"env",
		),
	},
} as const satisfies Record<string, { item: string; dest: string }>;

type Target = keyof typeof TARGETS;

const args = process.argv.slice(2).filter((a) => a !== "--debug");

async function pull(target: Target) {
	const { item, dest } = TARGETS[target];
	info(`Pulling ${item} → ${dest}`);
	const bwItem = await bwGetItem(item);
	writeEnvFile(dest, fieldsToEnv(bwItem));
}

const USAGE = "Usage: bun scripts/secrets.ts {all|local|prod}";

async function main() {
	const command = args[0] ?? "all";
	debug(`command: ${command}`);

	if (command === "-h" || command === "--help" || command === "help") {
		console.log(USAGE);
		process.exit(0);
	}

	if (command !== "all" && command !== "local" && command !== "prod") {
		error(`Unknown command: ${command}`);
		console.log(USAGE);
		process.exit(1);
	}

	await preflight();
	const freshUnlock = await ensureUnlocked();
	await syncVault(freshUnlock);

	await pull(command === "prod" ? "prod" : "local");
}

main();
