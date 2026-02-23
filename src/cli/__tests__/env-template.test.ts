import { describe, expect, test } from "bun:test";
import { generateEnvFile } from "../env-template";

describe("generateEnvFile", () => {
	const content = generateEnvFile();

	test("contains WHISPER_SERVER_CMD as empty (user must fill in)", () => {
		expect(content).toContain("WHISPER_SERVER_CMD=\n");
	});

	test("contains INFERENCE_SERVER_PORT", () => {
		expect(content).toContain("INFERENCE_SERVER_PORT=");
	});

	test("contains INFERENCE_SERVER_HOST", () => {
		expect(content).toContain("INFERENCE_SERVER_HOST=");
	});

	test("contains LOG_LEVEL", () => {
		expect(content).toContain("LOG_LEVEL=");
	});

	test("contains comment documentation", () => {
		expect(content).toContain("# Inference Server Manager");
		expect(content).toContain("# Required:");
	});

	test("contains CORS_ORIGIN reference", () => {
		expect(content).toContain("CORS_ORIGIN");
	});
});
