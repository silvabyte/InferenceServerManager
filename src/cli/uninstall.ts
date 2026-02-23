import fs from "node:fs/promises";
import { getServiceFilePath, SERVICE_NAME } from "./constants";
import { exec, printError, printStep, printSuccess } from "./utils";

export async function uninstall(_args: string[]): Promise<void> {
	const totalSteps = 4;
	const serviceFilePath = getServiceFilePath();

	// 1. Stop service
	printStep(1, totalSteps, "Stopping service...");
	const stopResult = await exec("systemctl", ["--user", "stop", SERVICE_NAME]);
	if (stopResult.success) {
		printSuccess("Service stopped");
	} else {
		console.log("  Service was not running (skipped)");
	}

	// 2. Disable service
	printStep(2, totalSteps, "Disabling service...");
	const disableResult = await exec("systemctl", [
		"--user",
		"disable",
		SERVICE_NAME,
	]);
	if (disableResult.success) {
		printSuccess("Service disabled");
	} else {
		console.log("  Service was not enabled (skipped)");
	}

	// 3. Remove service file
	printStep(3, totalSteps, "Removing service file...");
	try {
		await fs.unlink(serviceFilePath);
		printSuccess(`Removed: ${serviceFilePath}`);
	} catch {
		console.log(`  Service file not found: ${serviceFilePath} (skipped)`);
	}

	// 4. Reload systemd
	printStep(4, totalSteps, "Reloading systemd...");
	const reloadResult = await exec("systemctl", ["--user", "daemon-reload"]);
	if (!reloadResult.success) {
		printError(`systemctl daemon-reload failed: ${reloadResult.stderr}`);
	} else {
		printSuccess("systemd reloaded");
	}

	console.log("\n--- Uninstall Complete ---\n");
	console.log("The following were NOT deleted (remove manually if desired):");
	console.log("  - Binary: ./dist/");
	console.log("  - Env file: ~/.config/transcription_manager/env");
	console.log("  - Config: ~/.config/transcription_manager/settings.json5");
}
