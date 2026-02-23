export interface ExecResult {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function exec(
	cmd: string,
	args: string[],
	opts?: { cwd?: string },
): Promise<ExecResult> {
	const proc = Bun.spawn([cmd, ...args], {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return {
		success: exitCode === 0,
		stdout,
		stderr,
		exitCode,
	};
}

export function printStep(
	current: number,
	total: number,
	message: string,
): void {
	console.log(`[${current}/${total}] ${message}`);
}

export function printSuccess(message: string): void {
	console.log(`OK: ${message}`);
}

export function printError(message: string): void {
	console.error(`ERROR: ${message}`);
}
