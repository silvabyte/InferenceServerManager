import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	ENTRY_POINT,
	getBinaryPath,
	getEnvFilePath,
	getProjectRoot,
	getServiceFilePath,
	SERVICE_NAME,
	XDG_DIR_NAME,
} from "../constants";

describe("constants", () => {
	test("SERVICE_NAME is inference-server-manager", () => {
		expect(SERVICE_NAME).toBe("inference-server-manager");
	});

	test("ENTRY_POINT is src/main.ts", () => {
		expect(ENTRY_POINT).toBe("src/main.ts");
	});

	test("XDG_DIR_NAME is transcription_manager", () => {
		expect(XDG_DIR_NAME).toBe("transcription_manager");
	});

	test("getProjectRoot returns cwd in dev mode", () => {
		// In test/dev mode, process.execPath points to the bun binary, not dist/
		const root = getProjectRoot();
		expect(root).toBe(process.cwd());
	});

	test("getBinaryPath returns <root>/dist/inference-server-manager", () => {
		const root = getProjectRoot();
		const binaryPath = getBinaryPath();
		expect(binaryPath).toBe(
			path.join(root, "dist", "inference-server-manager"),
		);
	});

	test("getEnvFilePath returns ~/.config/transcription_manager/env", () => {
		const envPath = getEnvFilePath();
		expect(envPath).toBe(
			path.join(
				process.env.HOME ?? "",
				".config",
				"transcription_manager",
				"env",
			),
		);
	});

	test("getEnvFilePath respects XDG_CONFIG_HOME", () => {
		const original = process.env.XDG_CONFIG_HOME;
		try {
			process.env.XDG_CONFIG_HOME = "/data/config";
			const envPath = getEnvFilePath();
			expect(envPath).toBe(
				path.join("/data/config", "transcription_manager", "env"),
			);
		} finally {
			if (original === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = original;
			}
		}
	});

	test("getServiceFilePath returns ~/.config/systemd/user/<service>.service", () => {
		const servicePath = getServiceFilePath();
		expect(servicePath).toBe(
			path.join(
				process.env.HOME ?? "",
				".config",
				"systemd",
				"user",
				"inference-server-manager.service",
			),
		);
	});

	test("getServiceFilePath respects XDG_CONFIG_HOME", () => {
		const original = process.env.XDG_CONFIG_HOME;
		try {
			process.env.XDG_CONFIG_HOME = "/data/config";
			const servicePath = getServiceFilePath();
			expect(servicePath).toBe(
				path.join(
					"/data/config",
					"systemd",
					"user",
					"inference-server-manager.service",
				),
			);
		} finally {
			if (original === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = original;
			}
		}
	});
});
