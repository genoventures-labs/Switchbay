import { expect, test } from "bun:test";
import { modelSpeakerLabel, parseModelAddress } from "./model-identity";

test("recognizes model names only when they address the start of a turn", () => {
  expect(parseModelAddress("Hey Claude, inspect this repo")).toEqual({ lane: "cloud", provider: "anthropic", speaker: "Claude" });
  expect(parseModelAddress("GPT: review Claude's plan")).toEqual({ lane: "cloud", provider: "openai", speaker: "GPT" });
  expect(parseModelAddress("yo Gemini — research this")).toEqual({ lane: "cloud", provider: "google", speaker: "Gemini" });
  expect(parseModelAddress("OpenRouter, take this one")).toEqual({ lane: "openrouter", speaker: "OpenRouter" });
  expect(parseModelAddress("Ollama Cloud: summarize this")).toEqual({ lane: "local", localProvider: "ollama-cloud", speaker: "Ollama Cloud" });
  expect(parseModelAddress("Compare Claude and GPT for this job")).toBeNull();
  expect(parseModelAddress("This mentions Gemini later")).toBeNull();
});

test("labels the actual responding model family", () => {
  expect(modelSpeakerLabel({ provider: "anthropic", model: "claude-sonnet-4-6" })).toBe("Claude");
  expect(modelSpeakerLabel({ provider: "openai", model: "gpt-5.4-mini" })).toBe("GPT");
  expect(modelSpeakerLabel({ provider: "google", model: "gemini-2.5-pro" })).toBe("Gemini");
  expect(modelSpeakerLabel({ provider: "openrouter", model: "anthropic/claude-opus" })).toBe("Claude");
});
