import Claude from "@lobehub/icons/es/Claude";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Doubao from "@lobehub/icons/es/Doubao";
import Gemini from "@lobehub/icons/es/Gemini";
import OpenAI from "@lobehub/icons/es/OpenAI";
import {
  COUNCIL_MODEL_ID,
  getModelProvider,
  isCouncilModel,
  isSeedModel,
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
};

const COUNCIL_PROVIDERS = ["openai", "claude", "gemini", "seed"];

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

function CouncilComposite({ size = 16, avatar = false }) {
  const gap = Math.max(1, Math.round(size * 0.08));
  const tileSize = Math.max(6, Math.floor((size - gap) / 2));

  return (
    <span
      className="inline-grid shrink-0"
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(2, ${tileSize}px)`,
        gridTemplateRows: `repeat(2, ${tileSize}px)`,
        gap,
      }}
      aria-hidden="true"
    >
      {COUNCIL_PROVIDERS.map((providerName) => (
        <span
          key={providerName}
          className="inline-flex items-center justify-center overflow-hidden"
          style={{ width: tileSize, height: tileSize, borderRadius: avatar ? Math.max(3, Math.round(tileSize * 0.28)) : 0 }}
        >
          {avatar ? <ProviderAvatar provider={providerName} size={tileSize} /> : <ProviderGlyph provider={providerName} size={tileSize} />}
        </span>
      ))}
    </span>
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <CouncilComposite size={size} />;
  }

  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilComposite size={size} />;
  }

  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <CouncilComposite size={size} avatar />;
  }

  const provider = resolveProvider(model);

  if (provider === "council") {
    return <CouncilComposite size={size} avatar />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
