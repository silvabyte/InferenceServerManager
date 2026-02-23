import { describe, expect, test } from "bun:test";
import { exec } from "../utils";

describe("exec", () => {
	test("captures stdout from a simple command", async () => {
		const result = await exec("echo", ["hello"]);
		expect(result.success).toBe(true);
		expect(result.stdout.trim()).toBe("hello");
		expect(result.exitCode).toBe(0);
	});

	test("returns success: false for a failing command", async () => {
		const result = await exec("false", []);
		expect(result.success).toBe(false);
		expect(result.exitCode).not.toBe(0);
	});

	test("captures stderr", async () => {
		const result = await exec("bash", ["-c", "echo error >&2"]);
		expect(result.stderr.trim()).toBe("error");
	});
});
