import { describe, expect, test } from "bun:test";
import { generateServiceFile } from "../systemd";

describe("generateServiceFile", () => {
	const content = generateServiceFile({
		binaryPath: "/opt/project/dist/inference-server-manager",
		envFilePath: "/home/user/.config/transcription_manager/env",
	});

	test("contains [Unit] section", () => {
		expect(content).toContain("[Unit]");
	});

	test("contains [Service] section", () => {
		expect(content).toContain("[Service]");
	});

	test("contains [Install] section", () => {
		expect(content).toContain("[Install]");
	});

	test("ExecStart contains the provided binary path", () => {
		expect(content).toContain(
			"ExecStart=/opt/project/dist/inference-server-manager",
		);
	});

	test("EnvironmentFile contains the provided env file path", () => {
		expect(content).toContain(
			"EnvironmentFile=/home/user/.config/transcription_manager/env",
		);
	});

	test("contains Restart=on-failure", () => {
		expect(content).toContain("Restart=on-failure");
	});

	test("contains WantedBy=default.target", () => {
		expect(content).toContain("WantedBy=default.target");
	});

	test("contains Type=simple", () => {
		expect(content).toContain("Type=simple");
	});

	test("contains TimeoutStopSec=30", () => {
		expect(content).toContain("TimeoutStopSec=30");
	});
});
