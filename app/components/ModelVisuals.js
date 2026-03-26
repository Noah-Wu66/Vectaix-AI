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
  normalizeAgentDriverModelId,
} from "@/lib/shared/models";

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

function resolveVisualModel(model, agentModel) {
  if (model === AGENT_MODEL_ID) {
    return normalizeAgentDriverModelId(agentModel);
  }

  return model;
}

function resolveProvider(model, provider, agentModel) {
  const visualModel = resolveVisualModel(model, agentModel);
  if (model !== AGENT_MODEL_ID && provider) return provider;
  if (isCouncilModel(visualModel)) return "council";
  if (isSeedModel(visualModel)) return "seed";
  return getModelProvider(visualModel);
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

export function ModelGlyph({ model, provider, agentModel, size = 16 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <Perplexity.Color size={size} />;
  }

  const resolvedProvider = resolveProvider(model, provider, agentModel);

  if (resolvedProvider === "council") {
    return <Perplexity.Color size={size} />;
  }

  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, agentModel, size = 24 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <Perplexity.Avatar size={size} shape="square" />;
  }

  const provider = resolveProvider(model, undefined, agentModel);

  if (provider === "council") {
    return <Perplexity.Avatar size={size} shape="square" />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
