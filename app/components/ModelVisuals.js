import Claude from "@lobehub/icons/es/Claude";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Doubao from "@lobehub/icons/es/Doubao";
import Gemini from "@lobehub/icons/es/Gemini";
import Minimax from "@lobehub/icons/es/Minimax";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Perplexity from "@lobehub/icons/es/Perplexity";
import XiaomiMiMo from "./XiaomiMiMoIcon";
import {
  AGENT_MODEL_ID,
  COUNCIL_MODEL_ID,
  getModelProvider,
  isCouncilModel,
  isSeedModel,
} from "@/lib/shared/models";
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
  xiaomi: {
    Glyph: XiaomiMiMo.Color,
    Avatar: XiaomiMiMo.Avatar,
  },
  minimax: {
    Glyph: Minimax.Color,
    Avatar: Minimax.Avatar,
  },
};

function resolveProvider(model, provider) {
  if (provider) return provider;
  if (isCouncilModel(model)) return "council";
  if (isSeedModel(model)) return "seed";
  return getModelProvider(model);
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

export function ModelGlyph({ model, provider, size = 16, animate = false }) {
  if (model === AGENT_MODEL_ID) {
    return <CouncilIcon size={size} animate={animate} />;
  }

  if (model === COUNCIL_MODEL_ID) {
    return <Perplexity.Color size={size} />;
  }

  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <Perplexity.Color size={size} />;
  }

  if (resolvedProvider === "vectaix") {
    return <CouncilIcon size={size} animate={animate} />;
  }

  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24, animate = false }) {
  if (model === AGENT_MODEL_ID) {
    return <CouncilAvatar size={size} animate={animate} />;
  }

  if (model === COUNCIL_MODEL_ID) {
    return <Perplexity.Avatar size={size} shape="square" />;
  }

  const provider = resolveProvider(model);

  if (provider === "council") {
    return <Perplexity.Avatar size={size} shape="square" />;
  }

  if (provider === "vectaix") {
    return <CouncilAvatar size={size} animate={animate} />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
