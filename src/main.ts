export {};

// CLI check BEFORE any server imports (avoids side effects in global.ts, config.ts)
const _cliCommand = process.argv[2];

if (_cliCommand) {
	const { runCli } = await import("./cli");
	await runCli(_cliCommand, process.argv.slice(3));
	process.exit(0);
}

// No CLI command — start the server
await import("./index");
