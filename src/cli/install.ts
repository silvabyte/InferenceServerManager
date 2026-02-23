import fs from "node:fs/promises";
import path from "node:path";
import { compileBinary } from "./build";
import {
	getBinaryPath,
	getEnvFilePath,
	getServiceFilePath,
	SERVICE_NAME,
} from "./constants";
import { generateEnvFile } from "./env-template";
import { generateServiceFile } from "./systemd";
import { exec, printError, printStep, printSuccess } from "./utils";

export async function install(_args: string[]): Promise<void> {
	const totalSteps = 6;
	const binaryPath = getBinaryPath();
	const envFilePath = getEnvFilePath();
	const serviceFilePath = getServiceFilePath();

	// 1. Compile binary
	printStep(1, totalSteps, "Compiling binary...");
	if (!(await compileBinary())) {
		process.exit(1);
	}

	// 2. Create env file (only if it doesn't exist)
	printStep(2, totalSteps, "Setting up environment file...");
	await fs.mkdir(path.dirname(envFilePath), { recursive: true });
	try {
		await fs.access(envFilePath);
		console.log(`  Env file already exists: ${envFilePath} (preserved)`);
	} catch {
		await fs.writeFile(envFilePath, generateEnvFile());
		printSuccess(`Env file created: ${envFilePath}`);
		console.log(
			"\n  *** IMPORTANT: Edit the env file and set WHISPER_SERVER_CMD ***",
		);
		console.log(`  nano ${envFilePath}\n`);
	}

	// 3. Write systemd service file
	printStep(3, totalSteps, "Writing systemd service file...");
	await fs.mkdir(path.dirname(serviceFilePath), { recursive: true });
	const serviceContent = generateServiceFile({ binaryPath, envFilePath });
	await fs.writeFile(serviceFilePath, serviceContent);
	printSuccess(`Service file written: ${serviceFilePath}`);

	// 4. Reload systemd
	printStep(4, totalSteps, "Reloading systemd...");
	const reloadResult = await exec("systemctl", ["--user", "daemon-reload"]);
	if (!reloadResult.success) {
		printError(`systemctl daemon-reload failed: ${reloadResult.stderr}`);
		process.exit(1);
	}
	printSuccess("systemd reloaded");

	// 5. Enable and start
	printStep(5, totalSteps, "Enabling and starting service...");
	const enableResult = await exec("systemctl", [
		"--user",
		"enable",
		"--now",
		SERVICE_NAME,
	]);
	if (!enableResult.success) {
		printError(`Failed to enable/start service: ${enableResult.stderr}`);
		process.exit(1);
	}
	printSuccess("Service enabled and started");

	// 6. Enable lingering
	printStep(6, totalSteps, "Enabling login lingering...");
	const user = process.env.USER ?? "";
	const lingerResult = await exec("loginctl", ["enable-linger", user]);
	if (!lingerResult.success) {
		console.log(
			`  Warning: loginctl enable-linger failed: ${lingerResult.stderr}`,
		);
		console.log("  The service may stop when you log out.");
	} else {
		printSuccess("Lingering enabled (service survives logout)");
	}

	// Final summary
	console.log("\n--- Installation Complete ---\n");
	console.log(`  Binary:       ${binaryPath}`);
	console.log(`  Service file: ${serviceFilePath}`);
	console.log(`  Env file:     ${envFilePath}`);
	console.log("\nUseful commands:");
	console.log(`  systemctl --user status ${SERVICE_NAME}`);
	console.log(`  journalctl --user -u ${SERVICE_NAME} -f`);
	console.log(`  ${binaryPath} update     # recompile & restart`);
	console.log(`  ${binaryPath} uninstall  # remove service`);
}
