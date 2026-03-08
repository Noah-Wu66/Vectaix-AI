import { OPENAI_PRIMARY_MODEL } from "../lib/openaiModel";
import { SEED_MODEL_ID } from "../lib/seedModel";

export const CHAT_MODELS = [
  {
    id: "gemini-3-flash-preview",
    name: "Flash",
    shortName: "Flash",
    provider: "gemini",
    contextWindow: 1000000,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Pro",
    shortName: "Pro",
    provider: "gemini",
    contextWindow: 1000000,
  },
  {
    id: "claude-sonnet-4-6-20260219",
    name: "Sonnet",
    shortName: "Sonnet",
    provider: "claude",
    contextWindow: 200000,
  },
  {
    id: "claude-opus-4-6-20260205",
    name: "Opus",
    shortName: "Opus",
    provider: "claude",
    contextWindow: 200000,
  },
  {
    id: OPENAI_PRIMARY_MODEL,
    name: "GPT-5.4",
    shortName: "GPT",
    provider: "openai",
    contextWindow: 1050000,
  },
  {
    id: SEED_MODEL_ID,
    name: "Seed 2.0 Pro",
    shortName: "Seed",
    provider: "seed",
    contextWindow: 256000,
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek",
    shortName: "DeepSeek",
    provider: "deepseek",
    contextWindow: 128000,
  },
];
