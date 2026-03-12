import { describe, expect, test } from "bun:test";
import { Manager } from "..";

describe("parseTranscription", () => {
	test("should parse standard verbose_json response", () => {
		const raw = {
			text: "Hello world",
			segments: [
				{
					start: 0.0,
					end: 2.5,
					text: " Hello world",
					confidence: 0.92,
				},
			],
		};

		const result = Manager.parseTranscription(raw, "en", {});
		expect(result.text).toBe("Hello world");
		expect(result.language).toBe("en");
		expect(result.duration).toBe(2.5);
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0]?.text).toBe("Hello world");
		expect(result.segments[0]?.start).toBe(0.0);
		expect(result.segments[0]?.end).toBe(2.5);
		expect(result.provider).toBe("whisper-server");
	});

	test("should handle empty segments", () => {
		const raw = { text: "", segments: [] };
		const result = Manager.parseTranscription(raw);
		expect(result.text).toBe("");
		expect(result.duration).toBe(0);
		expect(result.confidence).toBe(0.0);
		expect(result.segments).toHaveLength(0);
	});

	test("should handle 'transcript' field instead of 'text'", () => {
		const raw = { transcript: "Alternate field", segments: [] };
		const result = Manager.parseTranscription(raw);
		expect(result.text).toBe("Alternate field");
	});

	test("should default language to 'en'", () => {
		const raw = { text: "test", segments: [] };
		const result = Manager.parseTranscription(raw);
		expect(result.language).toBe("en");
	});

	test("should pass through metadata", () => {
		const raw = { text: "test", segments: [] };
		const result = Manager.parseTranscription(raw, "en", { source: "test" });
		expect(result.metadata).toEqual({ source: "test" });
	});

	test("should trim segment text", () => {
		const raw = {
			text: "hello",
			segments: [{ start: 0, end: 1, text: "  hello  " }],
		};
		const result = Manager.parseTranscription(raw);
		expect(result.segments[0]?.text).toBe("hello");
	});
});
