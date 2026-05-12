import { type Counter, type Histogram, metrics } from "@opentelemetry/api";
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
import { Axiom } from "./axiom";
import { Log } from "./logger";

/**
 * OpenTelemetry metrics.
 *
 * `init()` only does anything when an exporter target is configured — either
 * `AXIOM_TOKEN` (+ a metrics dataset; see {@link Axiom}) or a raw
 * `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`.
 * Otherwise this module is inert (every `record*` helper is a no-op).
 *
 * Note: the OpenTelemetry metrics API has no "proxy meter" (unlike traces), so
 * instruments created before `setGlobalMeterProvider` are *permanent* no-ops.
 * Everything is therefore created lazily inside `init()` / `bindObservables()`.
 */
export namespace Metrics {
	const log = Log.child({ module: "Metrics" });
	const DEFAULT_EXPORT_INTERVAL_MS = 60_000;

	let provider: MeterProvider | undefined;
	let httpRequestDuration: Histogram | undefined;
	let transcriptionDuration: Histogram | undefined;
	let jobsProcessed: Counter | undefined;
	let workerRespawns: Counter | undefined;

	export function init(): void {
		const axiomCfg = Axiom.metricsOtlp();
		const otelEndpoint =
			Bun.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
			Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		if (!axiomCfg && !otelEndpoint) {
			log.debug(
				"no AXIOM_TOKEN or OTEL_EXPORTER_OTLP_ENDPOINT; metrics disabled",
			);
			return;
		}

		const exportIntervalMillis = Number(
			Bun.env.OTEL_METRIC_EXPORT_INTERVAL ?? DEFAULT_EXPORT_INTERVAL_MS,
		);

		// When AXIOM_TOKEN is set, point straight at Axiom's OTLP endpoint;
		// otherwise OTLPMetricExporter() reads OTEL_EXPORTER_OTLP_* env vars itself.
		const exporter = axiomCfg
			? new OTLPMetricExporter({
					headers: axiomCfg.headers,
					url: axiomCfg.url,
				})
			: new OTLPMetricExporter();

		provider = new MeterProvider({
			readers: [
				new PeriodicExportingMetricReader({ exporter, exportIntervalMillis }),
			],
			resource: resourceFromAttributes({
				[ATTR_SERVICE_NAME]: Bun.env.OTEL_SERVICE_NAME ?? AppName,
				[ATTR_SERVICE_VERSION]: version,
			}),
		});
		metrics.setGlobalMeterProvider(provider);

		const meter = metrics.getMeter(AppName, version);
		// HTTP server requests: a histogram already carries count + sum + buckets,
		// so no separate request counter is needed.
		httpRequestDuration = meter.createHistogram(
			"http.server.request.duration",
			{
				description: "Duration of inbound HTTP requests",
				unit: "s",
			},
		);
		// Time spent in a single whisper `/inference` call. Covers both the
		// synchronous transcription route and the background job processor.
		transcriptionDuration = meter.createHistogram("transcription.duration", {
			description: "Duration of a whisper inference request",
			unit: "s",
		});
		// Jobs finished by the background processor (includes the ffmpeg step).
		jobsProcessed = meter.createCounter("jobs.processed", {
			description: "Transcription jobs finished by the background processor",
		});
		// Worker process churn.
		workerRespawns = meter.createCounter("worker.respawns", {
			description: "Worker processes replaced or respawned",
		});

		log.info(
			{ exportIntervalMillis, target: axiomCfg ? "axiom" : otelEndpoint },
			"OTel metrics initialized",
		);
	}

	/**
	 * Wire the observable gauges to live state. Call once, after `init()` and
	 * after the worker manager + job processor are up. No-op when metrics are
	 * disabled.
	 */
	export function bindObservables(src: {
		poolStatus: () => { totalWorkers: number; healthyWorkers: number };
		processorStatus: () => { activeJobs: number; queuedJobs: number };
	}): void {
		if (!provider) return;
		const meter = metrics.getMeter(AppName, version);
		const workerPoolTotal = meter.createObservableGauge("worker.pool.total", {
			description: "Workers currently in the pool",
		});
		const workerPoolHealthy = meter.createObservableGauge(
			"worker.pool.healthy",
			{ description: "Workers currently passing health checks" },
		);
		const jobsQueued = meter.createObservableGauge("jobs.queued", {
			description: "Jobs waiting to be processed",
		});
		const jobsActive = meter.createObservableGauge("jobs.active", {
			description: "Jobs currently being processed",
		});
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
		httpRequestDuration = undefined;
		transcriptionDuration = undefined;
		jobsProcessed = undefined;
		workerRespawns = undefined;
	}

	// --- recording helpers (no-ops until init() has run) -------------------

	export function recordHttpRequest(a: {
		route: string;
		method: string;
		status: number;
		durationMs: number;
	}): void {
		httpRequestDuration?.record(a.durationMs / 1000, {
			"http.request.method": a.method,
			"http.response.status_code": a.status,
			"http.route": a.route,
		});
	}

	export function recordTranscription(durationMs: number, ok: boolean): void {
		transcriptionDuration?.record(durationMs / 1000, {
			outcome: ok ? "success" : "failure",
		});
	}

	export function recordJob(outcome: "completed" | "failed"): void {
		jobsProcessed?.add(1, { outcome });
	}

	export function recordWorkerRespawn(
		reason: "unhealthy" | "dead" | "rotation",
	): void {
		workerRespawns?.add(1, { reason });
	}
}
