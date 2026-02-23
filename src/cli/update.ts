import { compileBinary } from "./build";
import { SERVICE_NAME } from "./constants";
import { exec, printError, printStep, printSuccess } from "./utils";

export async function update(_args: string[]): Promise<void> {
	const totalSteps = 5;

	// 1. Stop service
	printStep(1, totalSteps, "Stopping service...");
	const stopResult = await exec("systemctl", ["--user", "stop", SERVICE_NAME]);
	if (stopResult.success) {
		printSuccess("Service stopped");
	} else {
		console.log("  Warning: Service may not be running, continuing...");
	}

	// 2. Recompile binary
	printStep(2, totalSteps, "Recompiling binary...");
	if (!(await compileBinary())) {
		// Try to restart old binary as safety net
		console.log("  Attempting to restart previous binary...");
		await exec("systemctl", ["--user", "start", SERVICE_NAME]);
		process.exit(1);
	}

	// 3. Reload systemd
	printStep(3, totalSteps, "Reloading systemd...");
	const reloadResult = await exec("systemctl", ["--user", "daemon-reload"]);
	if (!reloadResult.success) {
		printError(`systemctl daemon-reload failed: ${reloadResult.stderr}`);
	} else {
		printSuccess("systemd reloaded");
	}

	// 4. Start service
	printStep(4, totalSteps, "Starting service...");
	const startResult = await exec("systemctl", [
		"--user",
		"start",
		SERVICE_NAME,
	]);
	if (!startResult.success) {
		printError(`Failed to start service: ${startResult.stderr}`);
		process.exit(1);
	}
	printSuccess("Service started");

	// 5. Show status
	printStep(5, totalSteps, "Checking status...");
	const statusResult = await exec("systemctl", [
		"--user",
		"status",
		SERVICE_NAME,
	]);
	console.log(statusResult.stdout);
}
