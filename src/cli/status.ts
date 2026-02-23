import { SERVICE_NAME } from "./constants";
import { exec } from "./utils";

export async function status(_args: string[]): Promise<void> {
	const result = await exec("systemctl", ["--user", "status", SERVICE_NAME]);
	if (result.stdout) {
		console.log(result.stdout);
	}
	if (result.stderr) {
		console.error(result.stderr);
	}
	process.exit(result.exitCode);
}
