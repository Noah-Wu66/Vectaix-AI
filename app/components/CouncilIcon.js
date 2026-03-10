import { ClaudeCode } from "@lobehub/icons";

export function CouncilIcon({ size = 16, className = "" }) {
  return <ClaudeCode.Color size={size} className={className} />;
}

export function CouncilAvatar({ size = 24 }) {
  return <ClaudeCode.Avatar size={size} shape="square" />;
}
