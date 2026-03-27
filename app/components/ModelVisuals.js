import { CouncilAvatar, CouncilIcon } from "./CouncilIcon";
import {
  COUNCIL_MODEL_ID,
  getModelProvider,
  isCouncilModel,
  isSeedModel,
} from "@/lib/shared/models";

function BrandMark({
  size = 16,
  label = "",
  background = "#0f172a",
  color = "#ffffff",
  square = false,
}) {
  const fontSize = Math.max(8, Math.round(size * (square ? 0.4 : 0.48)));
  return (
    <span
      className="inline-flex items-center justify-center font-semibold select-none"
      style={{
        width: size,
        height: size,
        borderRadius: square ? Math.max(6, Math.round(size * 0.32)) : size,
        background,
        color,
        fontSize,
        lineHeight: 1,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

function createBrandVisual({
  label,
  background,
  color = "#ffffff",
}) {
  return {
    Glyph: function BrandGlyph({ size = 16 }) {
      return <BrandMark size={size} label={label} background={background} color={color} />;
    },
    Avatar: function BrandAvatar({ size = 24 }) {
      return <BrandMark size={size} label={label} background={background} color={color} square />;
    },
  };
}

const PROVIDER_VISUALS = {
  gemini: createBrandVisual({
    label: "G",
    background: "linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)",
  }),
  claude: createBrandVisual({
    label: "C",
    background: "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)",
  }),
  openai: createBrandVisual({
    label: "O",
    background: "linear-gradient(135deg, #111827 0%, #334155 100%)",
  }),
  seed: createBrandVisual({
    label: "S",
    background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
  }),
  xiaomi: createBrandVisual({
    label: "X",
    background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
  }),
  minimax: createBrandVisual({
    label: "M",
    background: "linear-gradient(135deg, #db2777 0%, #ec4899 100%)",
  }),
  deepseek: createBrandVisual({
    label: "D",
    background: "linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%)",
  }),
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

export function ModelGlyph({ model, provider, size = 16 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <CouncilIcon size={size} />;
  }

  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilIcon size={size} />;
  }

  return <ProviderGlyph provider={resolvedProvider} size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  if (model === COUNCIL_MODEL_ID) {
    return <CouncilAvatar size={size} />;
  }

  const provider = resolveProvider(model);

  if (provider === "council") {
    return <CouncilAvatar size={size} />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
