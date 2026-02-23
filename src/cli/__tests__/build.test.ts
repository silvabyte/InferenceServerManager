import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { ENTRY_POINT } from "../constants";

const testBinaryName = "inference-server-manager-test";
const testBinaryPath = path.join(process.cwd(), "dist", testBinaryName);

describe("build verification", () => {
	afterAll(async () => {
		// Clean up test binary
		try {
			await fs.unlink(testBinaryPath);
		} catch {
			// Already cleaned up or never created
		}
	});

	test(
		"bun build --compile produces a working binary",
		async () => {
			// Ensure dist directory exists
			await fs.mkdir(path.join(process.cwd(), "dist"), {
				recursive: true,
			});

			// Compile
			const buildProc = Bun.spawn(
				[
					"bun",
					"build",
					"--compile",
					"--minify",
					ENTRY_POINT,
					"--outfile",
					`dist/${testBinaryName}`,
				],
				{
					stdout: "pipe",
					stderr: "pipe",
					cwd: process.cwd(),
				},
			);
			const buildExit = await buildProc.exited;
			expect(buildExit).toBe(0);

			// Verify binary exists
			const stat = await fs.stat(testBinaryPath);
			expect(stat.isFile()).toBe(true);

			// Run --help
			const helpProc = Bun.spawn([testBinaryPath, "--help"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const helpStdout = await new Response(helpProc.stdout).text();
			const helpExit = await helpProc.exited;

			expect(helpExit).toBe(0);
			expect(helpStdout).toContain("Usage: inference-server-manager");

			// Run --version
			const versionProc = Bun.spawn([testBinaryPath, "--version"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const versionStdout = await new Response(versionProc.stdout).text();
			const versionExit = await versionProc.exited;

			expect(versionExit).toBe(0);
			expect(versionStdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
		},
		{ timeout: 60_000 },
	);
});
