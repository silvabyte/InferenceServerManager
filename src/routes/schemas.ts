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

export const WhisperWordSchema = t.Object({
	word: t.String(),
	start: t.Number(),
	end: t.Number(),
	t_dtw: t.Optional(t.Number()),
	probability: t.Optional(t.Number()),
});

export const WhisperSegmentSchema = t.Object({
	id: t.Number(),
	text: t.String(),
	start: t.Number(),
	end: t.Number(),
	tokens: t.Array(t.Number()),
	words: t.Optional(t.Array(WhisperWordSchema)),
	temperature: t.Optional(t.Number()),
	avg_logprob: t.Optional(t.Number()),
	no_speech_prob: t.Optional(t.Number()),
	compression_ratio: t.Optional(t.Number()),
	confidence: t.Optional(t.Number()),
	speaker: t.Optional(t.String()),
});

export const WhisperVerboseResponseSchema = t.Object({
	task: t.Optional(t.String()),
	language: t.Optional(t.String()),
	duration: t.Optional(t.Number()),
	text: t.Optional(t.String()),
	transcript: t.Optional(t.String()),
	segments: t.Array(WhisperSegmentSchema),
	detected_language: t.Optional(t.String()),
	detected_language_probability: t.Optional(t.Number()),
	language_probabilities: t.Optional(t.Record(t.String(), t.Number())),
});
