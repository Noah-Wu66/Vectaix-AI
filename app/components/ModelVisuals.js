import { isCouncilModel } from "../lib/councilModel";
import { isSeedModel } from "../lib/seedModel";
import { CouncilAvatar, CouncilIcon } from "./CouncilIcon";

const PROVIDER_VISUALS = {
  gemini: {
    glyphSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/gemini-color.png",
    avatarSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/gemini-color.png",
    avatarClass: "bg-white ring-1 ring-sky-100",
  },
  claude: {
    glyphSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/claude-color.png",
    avatarSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/claude-color.png",
    avatarClass: "bg-orange-50 ring-1 ring-orange-100",
  },
  openai: {
    glyphSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/openai.png",
    avatarSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/openai.png",
    avatarClass: "bg-white ring-1 ring-zinc-200",
  },
  seed: {
    glyphSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/doubao-color.png",
    avatarSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/doubao-color.png",
    avatarClass: "bg-white ring-1 ring-violet-100",
  },
  deepseek: {
    glyphSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/deepseek-color.png",
    avatarSrc: "https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/deepseek-color.png",
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
