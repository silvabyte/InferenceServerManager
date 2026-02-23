# Compile to Binary + systemd Daemon Installation

## Overview

Add the ability to compile the inference-server-manager into a standalone binary using `bun build --compile` and install it as a systemd user service. The binary lives in the project's `dist/` directory and the systemd service points to it in-place, enabling a simple `update` command that recompiles and restarts.

### Why a new entry point?

`src/index.ts` has top-level imports that trigger side effects — `global.ts` creates XDG directories, `config.ts` loads config files. CLI commands like `install` and `status` must NOT trigger these. The solution is a new entry point `src/main.ts` that dispatches CLI commands via dynamic imports before any server modules load.

---

## Tasks

### 1. Create `src/cli/constants.ts` — Shared constants

Exports used across all CLI modules:

```typescript
import path from "node:path";

export const SERVICE_NAME = "inference-server-manager";

export function getProjectRoot(): string {
    // Compiled binary lives at <root>/dist/inference-server-manager
    const execDir = path.dirname(process.execPath);
    if (path.basename(execDir) === "dist") {
        return path.dirname(execDir);
    }
    // Dev mode: running via `bun run src/main.ts`
    return process.cwd();
}

export function getBinaryPath(): string {
    return path.join(getProjectRoot(), "dist", SERVICE_NAME);
}

export function getEnvFilePath(): string {
    return path.join(process.env.HOME ?? "", ".config", "transcription_manager", "env");
}

export function getServiceFilePath(): string {
    return path.join(process.env.HOME ?? "", ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}
```

**Constraints**: Only import from `node:*` builtins. Never import from `../global`, `../config`, or any server module.

---

### 2. Create `src/cli/utils.ts` — CLI utility helpers

```typescript
import path from "node:path";

interface ExecResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

// Wrapper around Bun.spawn that captures output
export async function exec(
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
): Promise<ExecResult>;

// Console output helpers
export function printStep(current: number, total: number, message: string): void;
export function printSuccess(message: string): void;
export function printError(message: string): void;
```

Implementation notes:
- `exec` uses `Bun.spawn` with `stdout: "pipe"` and `stderr: "pipe"`
- Read stdout/stderr via `new Response(proc.stdout).text()`
- Await `proc.exited` for the exit code

---

### 3. Create `src/cli/systemd.ts` — Service file template generator

Export a function that generates a systemd user service unit file:

```typescript
export function generateServiceFile(opts: {
    binaryPath: string;
    envFilePath: string;
}): string;
```

The generated service file content:

```ini
[Unit]
Description=Inference Server Manager - Whisper worker pool and transcription API
After=network.target

[Service]
Type=simple
ExecStart=<binaryPath>
EnvironmentFile=<envFilePath>
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=inference-server-manager

[Install]
WantedBy=default.target
```

Key design decisions:
- `Type=simple` — the binary is the main process, no forking
- `Restart=on-failure` — auto-restart on crashes, not on clean `systemctl stop`
- `TimeoutStopSec=30` — allows 30s for graceful shutdown (worker cleanup)
- `StandardOutput=journal` — captured by journald; pino also writes its own rotating logs
- `WantedBy=default.target` — correct for user-level services

---

### 4. Create `src/cli/env-template.ts` — Environment file template

Export a function that generates the initial env file content:

```typescript
export function generateEnvFile(): string;
```

The template must document every runtime env var the server uses (found in `src/config.ts`, `src/index.ts`, `src/app.ts`, `src/global.ts`, `src/observability/logger.ts`):

```bash
# Inference Server Manager - Environment Configuration
# This file is loaded by the systemd service.
# Restart the service after editing:
#   systemctl --user restart inference-server-manager

# Required: Path to whisper server executable
WHISPER_SERVER_CMD=

# Optional: Working directory for whisper server
# WHISPER_SERVER_CWD=

# Server binding
INFERENCE_SERVER_PORT=3141
INFERENCE_SERVER_HOST=0.0.0.0

# CORS origin (for web UI access)
# CORS_ORIGIN=http://localhost:5173

# Logging level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Ensure ffmpeg and bun are available to the service
# PATH=/usr/local/bin:/usr/bin:/bin
```

---

### 5. Create `src/cli/install.ts` — Install command

```typescript
export async function install(args: string[]): Promise<void>;
```

Step-by-step implementation:

1. **Compile binary**: Run `bun build --compile --minify src/main.ts --outfile dist/inference-server-manager` with `cwd` set to the project root. Create `dist/` directory first. If compilation fails, print the error and exit 1.
2. **Create env file** at `~/.config/transcription_manager/env`: Create the directory `~/.config/transcription_manager/` (recursive). Only write the template if the file does NOT already exist (preserve user edits). If created, print a prominent reminder to set `WHISPER_SERVER_CMD`.
3. **Write systemd service file** to `~/.config/systemd/user/inference-server-manager.service`: Create `~/.config/systemd/user/` directory (recursive). Always overwrite (the template uses the current binary path).
4. **Reload systemd**: Run `systemctl --user daemon-reload`.
5. **Enable and start**: Run `systemctl --user enable --now inference-server-manager`.
6. **Enable lingering**: Run `loginctl enable-linger $USER` so the service survives logout.

Print a final summary with the binary path, service file path, env file path, and useful commands (`systemctl --user status`, `journalctl --user -u`, update, uninstall).

---

### 6. Create `src/cli/uninstall.ts` — Uninstall command

```typescript
export async function uninstall(args: string[]): Promise<void>;
```

Steps:
1. `systemctl --user stop inference-server-manager` (catch and ignore errors if not running)
2. `systemctl --user disable inference-server-manager` (catch and ignore errors)
3. Remove the service file at `~/.config/systemd/user/inference-server-manager.service` (catch if already gone)
4. `systemctl --user daemon-reload`

Print a note that the binary (`./dist/`), env file, and config file were NOT deleted (user must do this manually if desired).

---

### 7. Create `src/cli/update.ts` — Update command

```typescript
export async function update(args: string[]): Promise<void>;
```

Steps:
1. **Stop service**: `systemctl --user stop inference-server-manager`. If it fails, print a warning but continue (service may not be running).
2. **Recompile binary**: Same `bun build` command as install. If compilation FAILS: attempt to restart the old binary (`systemctl --user start`) as a safety net, then exit 1 with error message.
3. **Reload systemd**: `systemctl --user daemon-reload` (in case service file template changed).
4. **Start service**: `systemctl --user start inference-server-manager`.
5. **Show status**: Run `systemctl --user status inference-server-manager` and print its output.

---

### 8. Create `src/cli/status.ts` — Status command

```typescript
export async function status(args: string[]): Promise<void>;
```

Simple passthrough: run `systemctl --user status inference-server-manager`, print stdout, and exit with the same exit code as systemctl (0 = active, 3 = inactive, 4 = not found).

---

### 9. Create `src/cli/index.ts` — CLI router

```typescript
export async function runCli(command: string, args: string[]): Promise<void>;
```

Switch on `command`:
- `install` → dynamic import `./install`
- `uninstall` → dynamic import `./uninstall`
- `update` → dynamic import `./update`
- `status` → dynamic import `./status`
- `--help` / `-h` → print usage text
- `--version` / `-v` → print version from package.json (use `Bun.file` to read `package.json` from the project root)
- default → print "Unknown command" and exit 1

Help text should show:
```
Usage: inference-server-manager [command]

Commands:
  (no command)   Start the inference server (default)
  install        Compile binary and install systemd user service
  uninstall      Remove systemd user service
  update         Recompile binary and restart service
  status         Show service status

Options:
  --help, -h     Show this help message
  --version, -v  Show version
```

Use dynamic imports for each subcommand so only the needed module is loaded.

---

### 10. Create `src/main.ts` — New entry point

This is the compile target and the new dev/start target. Must be structured exactly like this:

```typescript
// CLI check BEFORE any server imports (avoids side effects in global.ts, config.ts)
const _cliCommand = process.argv[2];

if (
    _cliCommand &&
    ["install", "uninstall", "update", "status", "--help", "-h", "--version", "-v"].includes(_cliCommand)
) {
    const { runCli } = await import("./cli");
    await runCli(_cliCommand, process.argv.slice(3));
    process.exit(0);
}

// No CLI command — start the server
await import("./index");
```

**Critical**: No imports from server modules at the top level. The `await import("./index")` is dynamic and only runs when no CLI command is given.

---

### 11. Update `package.json` — Scripts

Modify existing scripts to use `src/main.ts` as the entry point and add a `build` script:

```json
{
  "module": "src/main.ts",
  "scripts": {
    "dev": "bun run --watch src/main.ts",
    "start": "bun run src/main.ts",
    "build": "mkdir -p dist && bun build --compile --minify src/main.ts --outfile dist/inference-server-manager"
  }
}
```

Leave all other scripts (`test`, `typecheck`, `fmt`, `lint`, `check`) unchanged.

---

### 12. Handle `App` type re-export

Currently `src/index.ts` line 144 has `export type { App } from "./app"`. Since `src/main.ts` is now the entry point and `src/index.ts` is imported dynamically, any external consumers importing the `App` type should import it from `src/app.ts` directly (where it's already defined at line 43: `export type App = ReturnType<typeof createApp>`).

Remove the re-export from `src/index.ts`:
```diff
- export type { App } from "./app";
```

If there are other files importing `App` from `./index`, update them to import from `./app` instead. Check with grep.

---

## Testing

### Unit Tests

**New file**: `src/cli/__tests__/constants.test.ts`

Test the following using `bun:test` (follow the pattern in `src/jobs/__tests__/store.test.ts`):

- `getProjectRoot()`: When `process.execPath` ends with `/dist/inference-server-manager`, returns the parent of `dist/`. Otherwise returns `process.cwd()`.
- `getBinaryPath()`: Returns `<projectRoot>/dist/inference-server-manager`.
- `getEnvFilePath()`: Returns `~/.config/transcription_manager/env`.
- `getServiceFilePath()`: Returns `~/.config/systemd/user/inference-server-manager.service`.

**New file**: `src/cli/__tests__/systemd.test.ts`

- `generateServiceFile()` returns valid content containing `[Unit]`, `[Service]`, `[Install]` sections
- The `ExecStart=` line contains the provided binary path
- The `EnvironmentFile=` line contains the provided env file path
- Contains `Restart=on-failure`
- Contains `WantedBy=default.target`

**New file**: `src/cli/__tests__/env-template.test.ts`

- `generateEnvFile()` returns content containing all required env var names: `WHISPER_SERVER_CMD`, `INFERENCE_SERVER_PORT`, `INFERENCE_SERVER_HOST`, `LOG_LEVEL`
- Contains comment documentation
- `WHISPER_SERVER_CMD=` line is present and empty (user must fill in)

**New file**: `src/cli/__tests__/utils.test.ts`

- `exec()` runs a simple command (e.g., `echo hello`) and captures stdout
- `exec()` returns `success: false` for a failing command (e.g., `false`)
- `exec()` captures stderr

### Integration Test

**New file**: `src/cli/__tests__/cli-router.test.ts`

Test the CLI dispatch by running the entry point with different arguments:
- `bun run src/main.ts --help` exits 0 and prints usage text
- `bun run src/main.ts --version` exits 0 and prints a version
- `bun run src/main.ts bogus-command` exits non-zero

Use `Bun.spawn` to run the commands and check stdout/exitCode.

### Build Verification Test

**New file**: `src/cli/__tests__/build.test.ts`

- Run `bun build --compile --minify src/main.ts --outfile dist/inference-server-manager-test` and assert it succeeds
- Run the compiled binary with `--help` and assert it exits 0 and prints usage
- Run the compiled binary with `--version` and assert it prints a version string
- Clean up the test binary after

This test provides confidence that `bun build --compile` works end-to-end with all dependencies. Mark this test file with a longer timeout (compilation takes several seconds).

---

## Documentation

### Update README.md

Add a new section after the existing "Quick Start" or similar section. Add these sections:

#### "Installation as a Service" section

```markdown
## Installation as a Service

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Linux with systemd
- FFmpeg installed and available on PATH

### Build & Install

\`\`\`bash
# Compile to standalone binary
bun run build

# Install as a systemd user service
./dist/inference-server-manager install

# Edit the environment file (set WHISPER_SERVER_CMD at minimum)
nano ~/.config/transcription_manager/env

# Restart to pick up env changes
systemctl --user restart inference-server-manager
\`\`\`

### Updating

After pulling new code:

\`\`\`bash
./dist/inference-server-manager update
\`\`\`

This recompiles the binary and restarts the service.

### Managing the Service

\`\`\`bash
# Check status
./dist/inference-server-manager status
# or: systemctl --user status inference-server-manager

# View logs
journalctl --user -u inference-server-manager -f

# Restart
systemctl --user restart inference-server-manager

# Uninstall
./dist/inference-server-manager uninstall
\`\`\`
```

#### Update the "Production" section

Replace the existing note about using pm2/systemd with a reference to the install command.

---

## Quality Assurance

### 1. Type Check

```bash
bun run typecheck
```

Ensure the new `src/cli/` files and `src/main.ts` pass type checking. The CLI modules should only use `node:*` types and Bun globals — no imports from server modules.

### 2. Lint & Format

```bash
bun run check
```

Run biome check on all new files to ensure they match project style.

### 3. Run All Tests

```bash
bun test
```

All existing tests in `src/jobs/__tests__/` must still pass. All new tests in `src/cli/__tests__/` must pass.

### 4. Manual Verification Checklist

After all automated checks pass, verify manually:

1. **Dev mode still works**: `bun run dev` starts the server normally (no CLI dispatch)
2. **Build compiles**: `bun run build` produces `dist/inference-server-manager`
3. **Help works**: `./dist/inference-server-manager --help` prints usage
4. **Version works**: `./dist/inference-server-manager --version` prints version
5. **Install works**: `./dist/inference-server-manager install` installs the service
6. **Status works**: `./dist/inference-server-manager status` shows service state
7. **Update works**: `./dist/inference-server-manager update` recompiles and restarts
8. **Uninstall works**: `./dist/inference-server-manager uninstall` removes the service

---

## File Summary

### New Files
- `src/main.ts` — New entry point (compile target)
- `src/cli/index.ts` — CLI router
- `src/cli/constants.ts` — Shared constants and path helpers
- `src/cli/utils.ts` — exec helper and console output
- `src/cli/systemd.ts` — systemd service file generator
- `src/cli/env-template.ts` — Environment file template generator
- `src/cli/install.ts` — Install command
- `src/cli/uninstall.ts` — Uninstall command
- `src/cli/update.ts` — Update command
- `src/cli/status.ts` — Status command
- `src/cli/__tests__/constants.test.ts` — Constants unit tests
- `src/cli/__tests__/systemd.test.ts` — Systemd template tests
- `src/cli/__tests__/env-template.test.ts` — Env template tests
- `src/cli/__tests__/utils.test.ts` — Utils unit tests
- `src/cli/__tests__/cli-router.test.ts` — CLI integration tests
- `src/cli/__tests__/build.test.ts` — Build verification test

### Modified Files
- `package.json` — Update `module`, `dev`, `start` scripts to `src/main.ts`; add `build` script
- `src/index.ts` — Remove `App` type re-export (line 144)
- `README.md` — Add "Installation as a Service" documentation

---

## Final Steps

### 1. Run Full QA Suite

```bash
bun run typecheck && bun run check && bun test
```

### 2. Commit Changes

Once all tests pass and manual verification is complete:

```bash
git add src/main.ts src/cli/ package.json src/index.ts README.md
git commit -m "feat: add compile-to-binary and systemd service installation

- Add src/main.ts entry point with CLI dispatch before server imports
- Add CLI subcommands: install, uninstall, update, status
- Generate systemd user service file pointing to in-project binary
- Generate environment file template with all runtime env vars
- Add bun build --compile script for standalone binary
- Update command recompiles binary and restarts service
- Include unit tests for templates, constants, and CLI routing
- Include build verification test for end-to-end compilation"
```
