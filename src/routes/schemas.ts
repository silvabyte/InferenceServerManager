import { t } from "elysia";

// --- Normalized transcription schemas (moved from routes/index.ts) ---

export const TranscriptionSegmentSchema = t.Object({
	confidence: t.Nullable(t.Number()),
	end: t.Number(),
	speaker: t.Nullable(t.String()),
	start: t.Number(),
	text: t.String(),
});

export const TranscriptionResultSchema = t.Object({
	confidence: t.Number(),
	duration: t.Number(),
	language: t.String(),
	metadata: t.Record(t.String(), t.String()),
	provider: t.String(),
	segments: t.Array(TranscriptionSegmentSchema),
	text: t.String(),
});

// --- Whisper verbose_json schemas ---

// Whisper emits `null` (not omitted) for several numeric fields on silent
// or low-confidence segments (e.g. avg_logprob, no_speech_prob). Typebox's
// `t.Optional(T)` means `T | undefined`, which does NOT accept explicit
// `null`, so we wrap every whisper-numeric-that-can-be-null in this helper.
const OptionalNullableNumber = t.Optional(t.Union([t.Number(), t.Null()]));

export const WhisperWordSchema = t.Object({
	word: t.String(),
	start: t.Number(),
	end: t.Number(),
	t_dtw: OptionalNullableNumber,
	probability: OptionalNullableNumber,
});

export const WhisperSegmentSchema = t.Object({
	id: t.Number(),
	text: t.String(),
	start: t.Number(),
	end: t.Number(),
	tokens: t.Array(t.Number()),
	words: t.Optional(t.Array(WhisperWordSchema)),
	temperature: OptionalNullableNumber,
	avg_logprob: OptionalNullableNumber,
	no_speech_prob: OptionalNullableNumber,
	compression_ratio: OptionalNullableNumber,
	confidence: OptionalNullableNumber,
	speaker: t.Optional(t.String()),
});

export const WhisperVerboseResponseSchema = t.Object({
	task: t.Optional(t.String()),
	language: t.Optional(t.String()),
	duration: OptionalNullableNumber,
	text: t.Optional(t.String()),
	transcript: t.Optional(t.String()),
	segments: t.Array(WhisperSegmentSchema),
	detected_language: t.Optional(t.String()),
	detected_language_probability: OptionalNullableNumber,
	language_probabilities: t.Optional(t.Record(t.String(), t.Number())),
});
