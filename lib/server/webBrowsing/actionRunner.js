import { runAgentControlText } from "@/lib/server/agent/driverAnswer";

export async function runWebBrowsingActionText({
  apiKey,
  maxTokens,
  model,
  onThought,
  req,
  systemText,
  thinkingLevel,
  userId,
  userText,
}) {
  return runAgentControlText({
    apiKey,
    req,
    userId,
    driverModel: model,
    systemPrompt: systemText,
    userText,
    thinkingLevel,
    maxTokens,
    temperature: 0.1,
    onThought,
  });
}
