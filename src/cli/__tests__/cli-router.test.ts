import { describe, expect, test } from "bun:test";

const entryPoint = "src/main.ts";

describe("CLI router", () => {
	test("--help exits 0 and prints usage", async () => {
		const proc = Bun.spawn(["bun", "run", entryPoint, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage: inference-server-manager");
		expect(stdout).toContain("Commands:");
	});

	test("--version exits 0 and prints a version", async () => {
		const proc = Bun.spawn(["bun", "run", entryPoint, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("unknown command exits non-zero", async () => {
		const proc = Bun.spawn(["bun", "run", entryPoint, "bogus-command"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;

		expect(exitCode).not.toBe(0);
	});
});
