import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { Metrics } from "./observability/metrics";
import { registerRoutes } from "./routes";

// Per-request start times. Keyed on the underlying Request, which is stable
// across the Elysia lifecycle, so it doesn't pollute the typed context.
const requestStart = new WeakMap<Request, number>();

/**
 * Create the Elysia app with all routes configured.
 * This function is used both by the main server and for type extraction.
 */
export function createApp() {
	const app = new Elysia();

	// CORS origin from environment variable (defaults to localhost:5173 for dev)
	const allowedOrigin = Bun.env.CORS_ORIGIN ?? "http://localhost:5173";

	// Enable CORS for UI development
	app.use((app) =>
		app.onBeforeHandle(({ set }) => {
			set.headers["Access-Control-Allow-Origin"] = allowedOrigin;
			set.headers["Access-Control-Allow-Methods"] =
				"GET, POST, PUT, DELETE, OPTIONS";
			set.headers["Access-Control-Allow-Headers"] = "Content-Type";
		}),
	);

	app.options("*", ({ set }) => {
		set.headers["Access-Control-Allow-Origin"] = allowedOrigin;
		set.headers["Access-Control-Allow-Methods"] =
			"GET, POST, PUT, DELETE, OPTIONS";
		set.headers["Access-Control-Allow-Headers"] = "Content-Type";
		return "";
	});

	// Inbound HTTP request metrics (no-op unless an OTLP endpoint is configured).
	app
		.onRequest(({ request }) => {
			requestStart.set(request, performance.now());
		})
		.onAfterResponse((ctx) => {
			try {
				const start = requestStart.get(ctx.request);
				requestStart.delete(ctx.request);
				Metrics.recordHttpRequest({
					durationMs: start === undefined ? 0 : performance.now() - start,
					method: ctx.request.method,
					route: ctx.route ?? new URL(ctx.request.url).pathname,
					status: typeof ctx.set.status === "number" ? ctx.set.status : 200,
				});
			} catch {
				// Metrics must never break the response path.
			}
		});

	app.use(openapi());

	registerRoutes(app);

	app.get("/", () => "Hello Robots");

	return app;
}

// Export type for Eden Treaty
export type App = ReturnType<typeof createApp>;
