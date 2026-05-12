import { beforeAll, describe, expect, test } from "bun:test";
import { Metrics } from "../metrics";

// These tests exercise the "no OTLP endpoint configured" path: the SDK is inert,
// every recording helper is a cheap no-op, and nothing throws.
describe("Metrics (disabled / no endpoint)", () => {
	beforeAll(() => {
		Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT = undefined;
		Bun.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = undefined;
	});

	test("init() is a silent no-op without an endpoint", () => {
		expect(() => Metrics.init()).not.toThrow();
	});

	test("recording helpers never throw", () => {
		expect(() => {
			Metrics.recordHttpRequest({
				durationMs: 12.3,
				method: "GET",
				route: "/health",
				status: 200,
			});
			Metrics.recordTranscription(456, true);
			Metrics.recordTranscription(789, false);
			Metrics.recordJob("completed");
			Metrics.recordJob("failed");
			Metrics.recordWorkerRespawn("unhealthy");
			Metrics.recordWorkerRespawn("dead");
			Metrics.recordWorkerRespawn("rotation");
		}).not.toThrow();
	});

	test("bindObservables() registers without a provider", () => {
		expect(() =>
			Metrics.bindObservables({
				poolStatus: () => ({ healthyWorkers: 2, totalWorkers: 3 }),
				processorStatus: () => ({ activeJobs: 1, queuedJobs: 4 }),
			}),
		).not.toThrow();
	});

	test("shutdown() resolves when nothing was started", async () => {
		await expect(Metrics.shutdown()).resolves.toBeUndefined();
	});
});
