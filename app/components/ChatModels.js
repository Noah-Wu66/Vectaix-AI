import { OPENAI_PRIMARY_MODEL } from "../lib/openaiModel";
import { SEED_MODEL_ID } from "../lib/seedModel";
import { COUNCIL_MODEL_ID } from "../lib/councilModel";

export const CHAT_MODELS = [
  {
    id: COUNCIL_MODEL_ID,
    name: "Council",
    shortName: "Council",
    provider: "council",
    contextWindow: 0,
  },
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
    name: "GPT",
    shortName: "GPT",
    provider: "openai",
    contextWindow: 1050000,
  },
  {
    id: SEED_MODEL_ID,
    name: "Seed",
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
