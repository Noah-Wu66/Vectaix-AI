import { AgentRuntimeCoordinator } from "@/lib/server/agent/core/coordinator";
import { runInstructionEngine } from "@/lib/server/agent/core/instructionEngine";

export async function runAgentRuntime({
  apiKey,
  attachments = [],
  config = {},
  conversationId,
  driverModel,
  historyMessages = [],
  images = [],
  prompt,
  req,
  sendEvent,
  userId,
}) {
  const coordinator = new AgentRuntimeCoordinator({
    conversationId,
    driverModel,
    prompt,
    sendEvent,
  });

  coordinator.init();

  try {
    const result = await runInstructionEngine({
      apiKey,
      attachments,
      config,
      conversationId,
      coordinator,
      driverModel,
      historyMessages,
      images,
      prompt,
      req,
      userId,
    });

    return {
      ...result,
      state: coordinator.finish(),
    };
  } catch (error) {
    coordinator.fail(error, "runtime");
    throw error;
  }
}
