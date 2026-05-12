// Bitwarden helpers shared by scripts/secrets.ts (and any future ops scripts).
// Preflight checks, cached session management, item fetching, and env-file
// helpers live here so every caller uses the exact same auth path.
//
// Mirrors the strategy from silvabyte/weekendgarden's scripts/lib/bw.ts.

import {
	chmodSync,
	existsSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { $ } from "bun";

const PASSWORD_FILE = `${process.env.HOME}/.bw_password`;
const SESSION_FILE = `${process.env.HOME}/.bw_session`;
const SESSION_TIMEOUT = 3600;

const BLUE = "\x1b[0;34m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const RED = "\x1b[0;31m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

export const colors = { BLUE, DIM, GREEN, NC, RED, YELLOW };

export const DEBUG = process.argv.includes("--debug");

export function info(msg: string) {
	console.log(`${BLUE}[INFO]${NC} ${msg}`);
}
export function success(msg: string) {
	console.log(`${GREEN}[OK]${NC} ${msg}`);
}
export function warn(msg: string) {
	console.log(`${YELLOW}[WARN]${NC} ${msg}`);
}
export function error(msg: string) {
	console.error(`${RED}[ERROR]${NC} ${msg}`);
}
export function debug(msg: string) {
	if (DEBUG) console.log(`${DIM}[DEBUG]${NC} ${msg}`);
}

export interface BwField {
	name: string;
	value: string;
}

export interface BwAttachment {
	id: string;
	fileName: string;
}

export interface BwLogin {
	username?: string;
	password?: string;
}

export interface BwItem {
	id: string;
	name: string;
	notes?: string;
	fields?: BwField[];
	attachments?: BwAttachment[];
	login?: BwLogin;
}

let bwSession = "";

export function sessionEnv(): Record<string, string> {
	return { ...process.env, BW_SESSION: bwSession } as Record<string, string>;
}

// Bun's $ shell doesn't have .timeout(), so we race against a timer.
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${ms}ms`)),
			ms,
		);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function preflight() {
	debug("Checking for bw CLI...");
	const result = await $`which bw`.nothrow().quiet();
	if (result.exitCode !== 0) {
		error("bw is required but not installed");
		process.exit(1);
	}
	debug("bw found");
}

async function isSessionValid(): Promise<boolean> {
	debug(`Checking session file: ${SESSION_FILE}`);

	if (!existsSync(SESSION_FILE)) {
		debug("Session file does not exist");
		return false;
	}

	const mtimeMs = statSync(SESSION_FILE).mtimeMs;
	const ageSeconds = (Date.now() - mtimeMs) / 1000;
	debug(
		`Session file age: ${Math.round(ageSeconds)}s (timeout: ${SESSION_TIMEOUT}s)`,
	);

	if (ageSeconds > SESSION_TIMEOUT) {
		debug("Session expired, removing file");
		await $`rm -f ${SESSION_FILE}`.nothrow().quiet();
		return false;
	}

	const session = readFileSync(SESSION_FILE, "utf-8").trim();
	debug("Validating session with bw unlock --check...");

	const check = await withTimeout(
		$`bw unlock --check`
			.env({ ...process.env, BW_SESSION: session })
			.nothrow()
			.quiet(),
		15_000,
		"bw unlock --check",
	);

	debug(`unlock --check exit code: ${check.exitCode}`);

	if (check.exitCode !== 0) {
		debug("Session invalid, removing file");
		await $`rm -f ${SESSION_FILE}`.nothrow().quiet();
		return false;
	}

	bwSession = session;
	debug("Session is valid");
	return true;
}

export async function ensureUnlocked(): Promise<boolean> {
	if (await isSessionValid()) {
		debug("Reusing cached session");
		return false;
	}

	if (!existsSync(PASSWORD_FILE)) {
		error(`Password file not found: ${PASSWORD_FILE}`);
		process.exit(1);
	}

	info("Unlocking Bitwarden...");
	debug(`bw unlock --passwordfile ${PASSWORD_FILE} --raw`);

	const result = await withTimeout(
		$`bw unlock --passwordfile ${PASSWORD_FILE} --raw`
			.env(process.env as Record<string, string>)
			.nothrow()
			.quiet(),
		30_000,
		"bw unlock",
	);

	debug(`unlock exit code: ${result.exitCode}`);
	if (result.stderr.length > 0)
		debug(`unlock stderr: ${result.stderr.toString().trim()}`);

	if (result.exitCode !== 0) {
		error(`Failed to unlock: ${result.stderr.toString().trim()}`);
		process.exit(1);
	}

	bwSession = result.stdout.toString().trim();
	writeFileSync(SESSION_FILE, bwSession);
	chmodSync(SESSION_FILE, 0o600);
	success("Vault unlocked");
	return true;
}

export async function syncVault(freshUnlock: boolean) {
	if (freshUnlock) {
		debug("Skipping sync — vault was just unlocked (already fresh)");
		return;
	}

	debug("Syncing vault (cached session)...");
	try {
		const result = await withTimeout(
			$`bw sync`.env(sessionEnv()).nothrow().quiet(),
			15_000,
			"bw sync",
		);

		debug(`sync exit code: ${result.exitCode}`);
		if (result.exitCode === 0) {
			debug("Sync succeeded");
		} else {
			warn("bw sync failed — continuing with cached data");
			debug(`sync stderr: ${result.stderr.toString().trim()}`);
		}
	} catch (e: unknown) {
		warn("bw sync timed out — continuing with cached data");
		debug(`sync error: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export async function bwGetItem(name: string): Promise<BwItem> {
	debug(`bw get item "${name}"`);

	const result = await withTimeout(
		$`bw get item ${name}`.env(sessionEnv()).nothrow().quiet(),
		30_000,
		`bw get item ${name}`,
	);

	debug(`get item exit code: ${result.exitCode}`);

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		if (stderr.includes("More than one result")) {
			error(
				`Multiple items named "${name}" — delete the duplicate in Bitwarden, or use an id instead`,
			);
		} else {
			error(`Item not found: ${name} (run 'bun run secrets:init' first)`);
		}
		debug(`stderr: ${stderr}`);
		process.exit(1);
	}

	const item: BwItem = JSON.parse(result.stdout.toString());
	debug(
		`Item "${name}" — fields: [${(item.fields ?? []).map((f) => f.name).join(", ")}], attachments: [${(item.attachments ?? []).map((a) => a.fileName).join(", ")}]`,
	);
	return item;
}

// Look up a named field on a Bitwarden item. Returns undefined if missing.
export function bwField(item: BwItem, name: string): string | undefined {
	return (item.fields ?? []).find((f) => f.name === name)?.value;
}

// Build a .env body from a Bitwarden item. Pulls from BOTH custom fields and
// the notes body (if notes look like KEY=value lines). Custom fields win on
// key collision.
export function fieldsToEnv(item: BwItem): string {
	const merged = new Map<string, string>();

	for (const line of (item.notes ?? "").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		merged.set(key, value);
	}

	for (const f of item.fields ?? []) {
		merged.set(f.name, f.value ?? "");
	}

	return Array.from(merged, ([k, v]) => `${k}=${v}`).join("\n");
}

export function writeEnvFile(dest: string, content: string) {
	const header =
		"# Auto-generated by scripts/secrets.ts — do not edit\n" +
		`# Pulled from Bitwarden on ${new Date().toISOString()}\n\n`;

	writeFileSync(dest, `${header + content}\n`);
	success(`Wrote ${dest}`);
}
