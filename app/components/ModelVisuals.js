import { isCouncilModel } from "../lib/councilModel";
import { isSeedModel } from "../lib/seedModel";
import { CouncilAvatar, CouncilIcon } from "./CouncilIcon";

const PROVIDER_STYLES = {
  gemini: {
    avatarClass: "bg-sky-100 text-sky-600",
    glyphClass: "text-sky-500",
  },
  claude: {
    avatarClass: "bg-orange-100 text-orange-600",
    glyphClass: "text-orange-500",
  },
  openai: {
    avatarClass: "bg-emerald-100 text-emerald-700",
    glyphClass: "text-emerald-600",
  },
  seed: {
    avatarClass: "bg-cyan-100 text-cyan-600",
    glyphClass: "text-cyan-500",
  },
  deepseek: {
    avatarClass: "bg-indigo-100 text-indigo-600",
    glyphClass: "text-indigo-500",
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

function BaseMark({ size, className = "", fill = "none", children }) {
  const classes = ["shrink-0", className].filter(Boolean).join(" ");

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      role="img"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={classes}
      fill={fill}
    >
      {children}
    </svg>
  );
}

function GeminiMark({ size, className = "" }) {
  return (
    <BaseMark size={size} className={className} fill="currentColor">
      <path d="M12 2.75 14.82 9.18 21.25 12l-6.43 2.82L12 21.25l-2.82-6.43L2.75 12l6.43-2.82L12 2.75Z" />
    </BaseMark>
  );
}

function ClaudeMark({ size, className = "" }) {
  return (
    <BaseMark size={size} className={className} fill="currentColor">
      <circle cx="8.25" cy="8.25" r="3.25" />
      <circle cx="15.75" cy="8.25" r="3.25" opacity="0.85" />
      <circle cx="8.25" cy="15.75" r="3.25" opacity="0.7" />
      <circle cx="15.75" cy="15.75" r="3.25" opacity="0.55" />
    </BaseMark>
  );
}

function OpenAIMark({ size, className = "" }) {
  return (
    <BaseMark size={size} className={className}>
      <path
        d="m12 3.25 6.5 3.75v7.5L12 18.25l-6.5-3.75V7l6.5-3.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
      <path
        d="M9.25 9.5h5.5M8.5 12h7M9.25 14.5h5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.85"
      />
    </BaseMark>
  );
}

function SeedMark({ size, className = "" }) {
  return (
    <BaseMark size={size} className={className}>
      <path
        d="M12 3.75c3.75 1.65 6.25 4.75 6.25 8.5 0 4.2-2.85 7.25-6.25 7.25s-6.25-3.05-6.25-7.25c0-3.75 2.5-6.85 6.25-8.5Z"
        fill="currentColor"
      />
      <path
        d="M12 7.25c0 4.15-.35 7.5-2.1 10.05"
        fill="none"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
    </BaseMark>
  );
}

function DeepSeekMark({ size, className = "" }) {
  return (
    <BaseMark size={size} className={className}>
      <path
        d="M4.25 12c2.2-3.35 4.95-5.05 7.75-5.05S17.55 8.65 19.75 12c-2.2 3.35-4.95 5.05-7.75 5.05S6.45 15.35 4.25 12Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
      <circle cx="12" cy="12" r="2.35" fill="currentColor" />
    </BaseMark>
  );
}

function ProviderMark({ provider, size, className = "" }) {
  if (provider === "seed") {
    return <SeedMark size={size} className={className} />;
  }
  if (provider === "deepseek") {
    return <DeepSeekMark size={size} className={className} />;
  }
  if (provider === "claude") {
    return <ClaudeMark size={size} className={className} />;
  }
  if (provider === "openai") {
    return <OpenAIMark size={size} className={className} />;
  }
  return <GeminiMark size={size} className={className} />;
}

function ProviderAvatar({ provider, size = 24 }) {
  const styles = PROVIDER_STYLES[provider] || PROVIDER_STYLES.gemini;

  return (
    <div
      className={`flex items-center justify-center rounded-md ${styles.avatarClass}`}
      style={{ width: size, height: size, borderRadius: 6 }}
    >
      <ProviderMark
        provider={provider}
        size={Math.max(14, Math.round(size * 0.65))}
        className={styles.glyphClass}
      />
    </div>
  );
}

export function ModelGlyph({ model, provider, size = 16 }) {
  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilIcon size={size} className="text-amber-500" />;
  }

  const styles = PROVIDER_STYLES[resolvedProvider] || PROVIDER_STYLES.gemini;
  return <ProviderMark provider={resolvedProvider} size={size} className={styles.glyphClass} />;
}

export function ModelAvatar({ model, size = 24 }) {
  const provider = resolveProvider(model);

  if (provider === "council") {
    return <CouncilAvatar size={size} />;
  }

  return <ProviderAvatar provider={provider} size={size} />;
}
