import Claude from "@lobehub/icons/es/Claude";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Doubao from "@lobehub/icons/es/Doubao";
import Gemini from "@lobehub/icons/es/Gemini";
import OpenAI from "@lobehub/icons/es/OpenAI";
import { isCouncilModel } from "../lib/councilModel";
import { isSeedModel } from "../lib/seedModel";
import { CouncilAvatar, CouncilIcon } from "./CouncilIcon";

const PROVIDER_VISUALS = {
  gemini: {
    Glyph: Gemini.Color,
    Avatar: Gemini.Avatar,
  },
  claude: {
    Glyph: Claude.Color,
    Avatar: Claude.Avatar,
  },
  openai: {
    Glyph: OpenAI,
    Avatar: OpenAI.Avatar,
  },
  seed: {
    Glyph: Doubao.Color,
    Avatar: Doubao.Avatar,
  },
  deepseek: {
    Glyph: DeepSeek.Color,
    Avatar: DeepSeek.Avatar,
  },
};

function resolveProvider(model, provider) {
  if (provider) return provider;
  if (isCouncilModel(model)) return "council";
  if (isSeedModel(model)) return "seed";
  if (typeof model === "string" && model.startsWith("deepseek-")) return "deepseek";
  if (typeof model === "string" && model.startsWith("claude-")) return "claude";
  if (typeof model === "string" && model.startsWith("gpt-")) return "openai";
  return "gemini";
}

function ProviderGlyph({ provider, size }) {
  const visual = PROVIDER_VISUALS[provider] || PROVIDER_VISUALS.gemini;
  const Glyph = visual.Glyph;
  return <Glyph size={size} />;
}

function ProviderAvatar({ provider, size = 24 }) {
  const visual = PROVIDER_VISUALS[provider] || PROVIDER_VISUALS.gemini;
  const Avatar = visual.Avatar;
  return <Avatar size={size} shape="square" />;
}

export function ModelGlyph({ model, provider, size = 16 }) {
  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilIcon size={size} />;
  }

  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  const provider = resolveProvider(model);

  if (provider === "council") {
    return <CouncilAvatar size={size} />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
