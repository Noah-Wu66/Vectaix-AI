import { OPENAI_PRIMARY_MODEL } from "../lib/openaiModel";
import { SEED_MODEL_ID } from "../lib/seedModel";
import { COUNCIL_MODEL_ID } from "../lib/councilModel";
import { CLAUDE_OPUS_MODEL, CLAUDE_SONNET_MODEL } from "../lib/claudeModel";
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from "../lib/geminiModel";
import { DEEPSEEK_REASONER_MODEL } from "../lib/deepseekModel";

export const CHAT_MODELS = [
  {
    id: COUNCIL_MODEL_ID,
    name: "Council",
    shortName: "Council",
    provider: "council",
    contextWindow: 0,
  },
  {
    id: GEMINI_FLASH_MODEL,
    name: "Flash",
    shortName: "Flash",
    provider: "gemini",
    contextWindow: 1000000,
  },
  {
    id: GEMINI_PRO_MODEL,
    name: "Pro",
    shortName: "Pro",
    provider: "gemini",
    contextWindow: 1000000,
  },
  {
    id: CLAUDE_SONNET_MODEL,
    name: "Sonnet",
    shortName: "Sonnet",
    provider: "claude",
    contextWindow: 200000,
  },
  {
    id: CLAUDE_OPUS_MODEL,
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
    id: DEEPSEEK_REASONER_MODEL,
    name: "DeepSeek",
    shortName: "DeepSeek",
    provider: "deepseek",
    contextWindow: 128000,
  },
];
