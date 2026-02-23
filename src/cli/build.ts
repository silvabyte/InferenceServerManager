import fs from "node:fs/promises";
import path from "node:path";
import {
	ENTRY_POINT,
	getBinaryPath,
	getProjectRoot,
	SERVICE_NAME,
} from "./constants";
import { exec, printError, printSuccess } from "./utils";

export async function compileBinary(): Promise<boolean> {
	const projectRoot = getProjectRoot();
	const binaryPath = getBinaryPath();

	await fs.mkdir(path.join(projectRoot, "dist"), { recursive: true });

	const result = await exec(
		"bun",
		[
			"build",
			"--compile",
			"--minify",
			ENTRY_POINT,
			"--outfile",
			`dist/${SERVICE_NAME}`,
		],
		{ cwd: projectRoot },
	);

	if (!result.success) {
		printError("Compilation failed:");
		console.error(result.stderr || result.stdout);
		return false;
	}

	printSuccess(`Binary compiled: ${binaryPath}`);
	return true;
}
