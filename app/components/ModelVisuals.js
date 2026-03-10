import { isCouncilModel } from "../lib/councilModel";
import { isSeedModel } from "../lib/seedModel";
import { CouncilAvatar, CouncilIcon } from "./CouncilIcon";

const LOBE_ICON_BASE_URL = "https://unpkg.com/@lobehub/icons-static-svg@1.82.0/icons";

const PROVIDER_VISUALS = {
  gemini: {
    glyphSrc: `${LOBE_ICON_BASE_URL}/gemini-color.svg`,
    avatarSrc: `${LOBE_ICON_BASE_URL}/gemini-color.svg`,
    avatarClass: "bg-white ring-1 ring-sky-100",
  },
  claude: {
    glyphSrc: `${LOBE_ICON_BASE_URL}/claude-color.svg`,
    avatarSrc: `${LOBE_ICON_BASE_URL}/claude-color.svg`,
    avatarClass: "bg-orange-50 ring-1 ring-orange-100",
  },
  openai: {
    glyphSrc: `${LOBE_ICON_BASE_URL}/openai.svg`,
    avatarSrc: `${LOBE_ICON_BASE_URL}/openai.svg`,
    avatarClass: "bg-white ring-1 ring-zinc-200",
  },
  seed: {
    glyphSrc: `${LOBE_ICON_BASE_URL}/doubao-color.svg`,
    avatarSrc: `${LOBE_ICON_BASE_URL}/doubao-color.svg`,
    avatarClass: "bg-white ring-1 ring-violet-100",
  },
  deepseek: {
    glyphSrc: `${LOBE_ICON_BASE_URL}/deepseek-color.svg`,
    avatarSrc: `${LOBE_ICON_BASE_URL}/deepseek-color.svg`,
    avatarClass: "bg-indigo-50 ring-1 ring-indigo-100",
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

function ProviderImage({ src, size, className = "" }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`block shrink-0 object-contain ${className}`}
      decoding="async"
      loading="eager"
      referrerPolicy="no-referrer"
    />
  );
}

function ProviderGlyph({ provider, size }) {
  const visual = PROVIDER_VISUALS[provider] || PROVIDER_VISUALS.gemini;
  return <ProviderImage src={visual.glyphSrc} size={size} />;
}

function ProviderAvatar({ provider, size = 24 }) {
  const visual = PROVIDER_VISUALS[provider] || PROVIDER_VISUALS.gemini;
  const innerSize = Math.max(16, Math.round(size * 0.72));

  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-md ${visual.avatarClass}`}
      style={{ width: size, height: size, borderRadius: 6 }}
    >
      <ProviderImage src={visual.avatarSrc} size={innerSize} />
    </div>
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilIcon size={size} className="text-amber-500" />;
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
