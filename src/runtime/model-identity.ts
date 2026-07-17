import { getCloudProviderConfig, type CloudProviderId } from "./cloud-providers";
import type { RuntimeLane } from "../config/env";
import { getLocalProviderConfig, type LocalProviderId } from "./local-providers";
import type { RuntimeModelOption } from "./models";
import type { ChatCompletionResponse } from "./types";

export type ModelAddress = {
  lane: RuntimeLane;
  provider?: CloudProviderId;
  localProvider?: LocalProviderId;
  speaker: string;
  auto?: boolean;
};

const MODEL_ADDRESS_PATTERN = /^(?:(?:hey|hi|yo|okay|ok)\s+)?(ollama\s+cloud|open\s*router|hugging\s*face|chatgpt|anthropic|claude|gemini|openai|google|ollama|auto|gpt|hf)(?=\s*[,;:!—–-]|\s+)/i;

export function parseModelAddress(input: string): ModelAddress | null {
  const match = input.trimStart().match(MODEL_ADDRESS_PATTERN);
  const name = match?.[1]?.toLowerCase();
  if (!name) return null;
  if (name === "auto") return { lane: "cloud", speaker: "Auto", auto: true };
  if (name === "claude" || name === "anthropic") return { lane: "cloud", provider: "anthropic", speaker: "Claude" };
  if (name === "gemini" || name === "google") return { lane: "cloud", provider: "google", speaker: "Gemini" };
  if (name.replace(/\s/g, "") === "openrouter") return { lane: "openrouter", speaker: "OpenRouter" };
  if (name === "hugging face" || name === "hf") return { lane: "huggingface", speaker: "Hugging Face" };
  if (name === "ollama cloud") return { lane: "local", localProvider: "ollama-cloud", speaker: "Ollama Cloud" };
  if (name === "ollama") return { lane: "local", localProvider: "ollama", speaker: "Ollama" };
  return { lane: "cloud", provider: "openai", speaker: "GPT" };
}

export function modelOptionForAddress(address: ModelAddress): RuntimeModelOption {
  if (address.auto) {
    return { id: "auto", label: "Auto · trusted cloud routing", lane: "cloud", provider: "auto", source: "auto" };
  }
  if (address.provider) {
    const config = getCloudProviderConfig(address.provider);
    return { id: config.model, label: config.label, lane: "cloud", provider: address.provider, source: "preset" };
  }
  if (address.lane === "openrouter") {
    const id = Bun.env.SWITCHBAY_OPENROUTER_MODEL?.trim() || "openai/gpt-5.2";
    return { id, label: id, lane: "openrouter", provider: "openrouter", source: "openrouter" };
  }
  if (address.lane === "huggingface") {
    const id = Bun.env.SWITCHBAY_HF_MODEL?.trim() || "openai/gpt-oss-120b:groq";
    return { id, label: id, lane: "huggingface", provider: "huggingface", source: "huggingface" };
  }
  const provider = address.localProvider ?? "ollama";
  const config = getLocalProviderConfig(provider);
  return { id: config.model ?? "", label: config.label, lane: "local", provider, source: provider };
}

export function modelSpeakerLabel(meta?: ChatCompletionResponse["meta"] | null): string {
  const provider = meta?.provider?.toLowerCase();
  if (provider === "anthropic") return "Claude";
  if (provider === "google") return "Gemini";
  if (provider === "openai") return "GPT";
  if (provider === "openrouter") return modelFamilyLabel(meta?.model) ?? "OpenRouter";
  if (provider === "huggingface") return modelFamilyLabel(meta?.model) ?? "Hugging Face";
  if (provider === "ollama" || provider === "ollama-cloud") return modelFamilyLabel(meta?.model) ?? "Ollama";
  return modelFamilyLabel(meta?.model) ?? "Model";
}

function modelFamilyLabel(model?: string): string | null {
  if (!model) return null;
  const normalized = model.toLowerCase();
  if (normalized.includes("claude")) return "Claude";
  if (normalized.includes("gemini")) return "Gemini";
  if (/\bgpt[-/:]|openai\//.test(normalized)) return "GPT";
  const tail = model.split("/").at(-1)?.split(":")[0]?.trim();
  return tail || null;
}
