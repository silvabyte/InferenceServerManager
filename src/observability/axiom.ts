/**
 * Central Axiom configuration.
 *
 * Logs are shipped with the `@axiomhq/js` client; metrics are shipped over OTLP
 * to Axiom's OpenTelemetry endpoint. Everything is driven by `AXIOM_TOKEN` plus
 * a dataset name — when `AXIOM_TOKEN` is unset this module is inert and the
 * service behaves exactly as before.
 *
 * Env vars:
 *   AXIOM_TOKEN            API token (xaat-...) — or a personal token, in which
 *                          case AXIOM_ORG_ID is also required
 *   AXIOM_ORG_ID           org id, only needed when AXIOM_TOKEN is a personal token
 *   AXIOM_URL              API base URL (default https://api.axiom.co; EU: https://api.eu.axiom.co)
 *   AXIOM_DATASET          fallback dataset for both logs and metrics
 *   AXIOM_LOGS_DATASET     dataset for logs    (overrides AXIOM_DATASET)
 *   AXIOM_METRICS_DATASET  dataset for metrics (overrides AXIOM_DATASET)
 */
export namespace Axiom {
	// Never ship telemetry from the test runner, even if .env has AXIOM_TOKEN.
	const token = Bun.env.NODE_ENV === "test" ? undefined : Bun.env.AXIOM_TOKEN;
	const orgId = Bun.env.AXIOM_ORG_ID;
	const baseUrl = (Bun.env.AXIOM_URL ?? "https://api.axiom.co").replace(
		/\/+$/,
		"",
	);
	const logsDataset = Bun.env.AXIOM_LOGS_DATASET ?? Bun.env.AXIOM_DATASET;
	const metricsDataset = Bun.env.AXIOM_METRICS_DATASET ?? Bun.env.AXIOM_DATASET;

	/** True when an Axiom token is configured. */
	export const enabled = Boolean(token);

	export interface LogsClientConfig {
		token: string;
		orgId?: string;
		url: string;
		dataset: string;
	}

	/** Config for the `@axiomhq/js` client used to ship logs, or undefined. */
	export function logsClient(): LogsClientConfig | undefined {
		if (!token || !logsDataset) return undefined;
		return { dataset: logsDataset, orgId, token, url: baseUrl };
	}

	export interface OtlpConfig {
		url: string;
		headers: Record<string, string>;
	}

	/** Config for the OTLP metrics exporter pointed at Axiom, or undefined. */
	export function metricsOtlp(): OtlpConfig | undefined {
		if (!token || !metricsDataset) return undefined;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			"X-Axiom-Dataset": metricsDataset,
		};
		if (orgId) headers["X-Axiom-Org-Id"] = orgId;
		return { headers, url: `${baseUrl}/v1/metrics` };
	}
}
