import { describe, expect, test } from "bun:test";
import { Axiom } from "../axiom";

// The test runner forces Axiom off (NODE_ENV=test) so the suite never ships
// telemetry, regardless of what's in .env. The enabled path is covered by the
// compiled-binary smoke test, not here.
describe("Axiom (inert under the test runner)", () => {
	test("enabled is false", () => {
		expect(Axiom.enabled).toBe(false);
	});

	test("logsClient() returns undefined", () => {
		expect(Axiom.logsClient()).toBeUndefined();
	});

	test("metricsOtlp() returns undefined", () => {
		expect(Axiom.metricsOtlp()).toBeUndefined();
	});
});
