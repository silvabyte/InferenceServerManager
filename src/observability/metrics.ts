import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { AppName, version } from "../global";
import { Log } from "./logger";

/**
 * OpenTelemetry metrics.
 *
 * Instruments are created at module load against a proxy meter, so they are
 * safe no-ops until {@link Metrics.init} wires up a real {@link MeterProvider}.
 * `init()` only does anything when an OTLP endpoint is configured via the
 * standard `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`
 * env vars — otherwise this module is inert.
 */
export namespace Metrics {
	const log = Log.child({ module: "Metrics" });
	const meter = metrics.getMeter(AppName, version);

	const DEFAULT_EXPORT_INTERVAL_MS = 60_000;

	// --- instruments -------------------------------------------------------

	// HTTP server requests: a histogram already carries count + sum + buckets,
	// so no separate request counter is needed.
	const httpRequestDuration = meter.createHistogram(
		"http.server.request.duration",
		{
			description: "Duration of inbound HTTP requests",
			unit: "s",
		},
	);

	// Time spent in a single whisper `/inference` call. Covers both the
	// synchronous transcription route and the background job processor.
	const transcriptionDuration = meter.createHistogram(
		"transcription.duration",
		{
			description: "Duration of a whisper inference request",
			unit: "s",
		},
	);

	// Jobs finished by the background processor (includes the ffmpeg step).
	const jobsProcessed = meter.createCounter("jobs.processed", {
		description: "Transcription jobs finished by the background processor",
	});

	// Worker process churn.
	const workerRespawns = meter.createCounter("worker.respawns", {
		description: "Worker processes replaced or respawned",
	});

	// Current pool / queue state (sampled at export time via bindObservables).
	const workerPoolTotal = meter.createObservableGauge("worker.pool.total", {
		description: "Workers currently in the pool",
	});
	const workerPoolHealthy = meter.createObservableGauge("worker.pool.healthy", {
		description: "Workers currently passing health checks",
	});
	const jobsQueued = meter.createObservableGauge("jobs.queued", {
		description: "Jobs waiting to be processed",
	});
	const jobsActive = meter.createObservableGauge("jobs.active", {
		description: "Jobs currently being processed",
	});

	// --- lifecycle ---------------------------------------------------------

	let provider: MeterProvider | undefined;

	export function init(): void {
		const endpoint =
			Bun.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
			Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		if (!endpoint) {
			log.debug("OTEL_EXPORTER_OTLP_ENDPOINT not set; metrics disabled");
			return;
		}

		const exportIntervalMillis = Number(
			Bun.env.OTEL_METRIC_EXPORT_INTERVAL ?? DEFAULT_EXPORT_INTERVAL_MS,
		);

		// OTLPMetricExporter reads OTEL_EXPORTER_OTLP_* env vars itself.
		const reader = new PeriodicExportingMetricReader({
			exporter: new OTLPMetricExporter(),
			exportIntervalMillis,
		});

		provider = new MeterProvider({
			readers: [reader],
			resource: resourceFromAttributes({
				[ATTR_SERVICE_NAME]: Bun.env.OTEL_SERVICE_NAME ?? AppName,
				[ATTR_SERVICE_VERSION]: version,
			}),
		});

		metrics.setGlobalMeterProvider(provider);
		log.info({ endpoint, exportIntervalMillis }, "OTel metrics initialized");
	}

	/**
	 * Wire the observable gauges to live state. Call once, after the worker
	 * manager and job processor are up.
	 */
	export function bindObservables(src: {
		poolStatus: () => { totalWorkers: number; healthyWorkers: number };
		processorStatus: () => { activeJobs: number; queuedJobs: number };
	}): void {
		meter.addBatchObservableCallback(
			(observer) => {
				const pool = src.poolStatus();
				observer.observe(workerPoolTotal, pool.totalWorkers);
				observer.observe(workerPoolHealthy, pool.healthyWorkers);

				const proc = src.processorStatus();
				observer.observe(jobsActive, proc.activeJobs);
				observer.observe(jobsQueued, proc.queuedJobs);
			},
			[workerPoolTotal, workerPoolHealthy, jobsActive, jobsQueued],
		);
	}

	export async function shutdown(): Promise<void> {
		await provider?.shutdown();
		provider = undefined;
	}

	// --- recording helpers -------------------------------------------------

	export function recordHttpRequest(a: {
		route: string;
		method: string;
		status: number;
		durationMs: number;
	}): void {
		httpRequestDuration.record(a.durationMs / 1000, {
			"http.request.method": a.method,
			"http.response.status_code": a.status,
			"http.route": a.route,
		});
	}

	export function recordTranscription(durationMs: number, ok: boolean): void {
		transcriptionDuration.record(durationMs / 1000, {
			outcome: ok ? "success" : "failure",
		});
	}

	export function recordJob(outcome: "completed" | "failed"): void {
		jobsProcessed.add(1, { outcome });
	}

	export function recordWorkerRespawn(
		reason: "unhealthy" | "dead" | "rotation",
	): void {
		workerRespawns.add(1, { reason });
	}
}
