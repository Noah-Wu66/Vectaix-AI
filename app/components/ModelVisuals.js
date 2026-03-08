import { Gemini, Claude, OpenAI, Doubao, DeepSeek } from "@lobehub/icons";
import { isCouncilModel } from "../lib/councilModel";
import { isSeedModel } from "../lib/seedModel";
import { CouncilAvatar, CouncilIcon } from "./CouncilIcon";

function resolveProvider(model, provider) {
  if (provider) return provider;
  if (isCouncilModel(model)) return "council";
  if (isSeedModel(model)) return "seed";
  if (typeof model === "string" && model.startsWith("deepseek-")) return "deepseek";
  if (typeof model === "string" && model.startsWith("claude-")) return "claude";
  if (typeof model === "string" && model.startsWith("gpt-")) return "openai";
  return "gemini";
}

export function ModelGlyph({ model, provider, size = 16 }) {
  const resolvedProvider = resolveProvider(model, provider);

  if (resolvedProvider === "council") {
    return <CouncilIcon size={size} className="text-amber-500" />;
  }
  if (resolvedProvider === "seed") {
    return <Doubao.Color size={size} />;
  }
  if (resolvedProvider === "deepseek") {
    return <DeepSeek.Color size={size} />;
  }
  if (resolvedProvider === "claude") {
    return <Claude.Color size={size} />;
  }
  if (resolvedProvider === "openai") {
    return <OpenAI size={size} />;
  }
  return <Gemini.Color size={size} />;
}

export function ModelAvatar({ model, size = 24 }) {
  const provider = resolveProvider(model);
  const avatarProps = {
    size,
    shape: "square",
    style: { borderRadius: 6 },
  };

  if (provider === "council") {
    return <CouncilAvatar size={size} />;
  }
  if (provider === "seed") {
    return <Doubao.Avatar {...avatarProps} />;
  }
  if (provider === "deepseek") {
    return <DeepSeek.Avatar {...avatarProps} />;
  }
  if (provider === "claude") {
    return <Claude.Avatar {...avatarProps} />;
  }
  if (provider === "openai") {
    return <OpenAI.Avatar {...avatarProps} type="gpt5" />;
  }
  return <Gemini.Avatar {...avatarProps} />;
}
