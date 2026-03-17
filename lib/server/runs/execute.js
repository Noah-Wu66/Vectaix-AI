import ChatRun from "@/models/ChatRun";
import { AGENT_MODEL_ID, getModelProvider } from "@/lib/shared/models";
import { buildAgentMessageMeta } from "@/lib/server/agent/runHelpers";
import {
  failChatRun,
  patchConversationMessage,
  syncChatRunSnapshot,
} from "@/lib/server/runs/service";
import { publishRunStatus } from "@/lib/server/realtime/publishers";

function resolveRoutePath(model) {
  const provider = getModelProvider(model);
  if (provider === "claude") return "/api/anthropic";
  if (provider === "openai") return "/api/openai";
  if (provider === "deepseek") return "/api/deepseek";
  if (provider === "seed") return "/api/bytedance";
  if (provider === "council") return "/api/council";
  if (provider === "vectaix") return "/api/agent";
  return "/api/google";
}

export function buildBaseUrl(headers) {
  const host = headers.host || headers["x-forwarded-host"];
  const protocol = headers["x-forwarded-proto"] || "https";
  if (!host) throw new Error("无法解析当前站点地址");
  return `${protocol}://${host}`;
}

function shouldPersistSnapshot(lastPersistAt) {
  return Date.now() - lastPersistAt >= 250;
}

async function updateAgentConversationPlaceholder({
  conversationId,
  userId,
  messageId,
  content,
  thought,
  citations,
  timeline,
  councilExperts,
  councilExpertStates,
  councilSummaryState,
  agentRun,
}) {
  await patchConversationMessage({
    conversationId,
    userId,
    messageId,
    patch: {
      content: typeof content === "string" && content ? content : (agentRun?.status === "completed" ? "任务已完成。" : "正在处理中..."),
      parts: [{ text: typeof content === "string" && content ? content : (agentRun?.status === "completed" ? "任务已完成。" : "正在处理中...") }],
      thought: typeof thought === "string" ? thought : "",
      citations: Array.isArray(citations) ? citations : null,
      thinkingTimeline: Array.isArray(timeline) ? timeline : [],
      councilExperts: Array.isArray(councilExperts) ? councilExperts : null,
      councilExpertStates: Array.isArray(councilExpertStates) ? councilExpertStates : null,
      councilSummaryState: councilSummaryState && typeof councilSummaryState === "object" ? councilSummaryState : null,
      agentRun,
    },
  });
  if (agentRun?.runId) {
    await publishRunStatus({
      conversationId,
      runId: agentRun.runId,
      runType: "agent",
      messageId,
      status: agentRun.status,
      phase: agentRun.executionState || agentRun.currentStep || agentRun.status,
      updatedAt: agentRun.updatedAt,
    });
  }
}

async function writeAgentFailurePlaceholder({
  conversationId,
  userId,
  messageId,
  runId = "",
  message,
}) {
  const errorMessage = typeof message === "string" && message ? message : "任务执行失败";
  await updateAgentConversationPlaceholder({
    conversationId,
    userId,
    messageId,
    content: errorMessage,
    thought: "",
    citations: [],
    timeline: [],
    councilExperts: [],
    councilExpertStates: [],
    councilSummaryState: null,
    agentRun: {
      runId,
      status: "failed",
      executionState: "failed",
      currentStep: "执行失败",
      canResume: false,
      lastError: errorMessage,
      failureReason: errorMessage,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function persistChatRunSnapshot(run, state, force = false) {
  const latestRun = await ChatRun.findById(run._id).select("status");
  if (!latestRun) return null;
  if (latestRun.status === "cancelled") {
    return latestRun;
  }
  if (!force && !shouldPersistSnapshot(state.lastPersistAt)) return run;
  state.lastPersistAt = Date.now();
  return syncChatRunSnapshot({
    run,
    patch: {
      status: state.status,
      phase: state.phase,
      outputText: state.outputText,
      thoughtText: state.thoughtText,
      citations: state.citations,
      searchContextTokens: state.searchContextTokens,
      timeline: state.timeline,
      councilExperts: state.councilExperts,
      councilExpertStates: state.councilExpertStates,
      councilSummaryState: state.councilSummaryState,
      errorMessage: state.errorMessage || "",
      ...(force && state.status === "completed" ? { finishedAt: new Date() } : {}),
    },
    conversationPatch: {
      content: state.outputText || (
        state.status === "failed"
          ? state.errorMessage || "任务执行失败"
          : state.status === "completed"
            ? "任务已完成。"
            : "正在处理中..."
      ),
      parts: [{ text: state.outputText || (
        state.status === "failed"
          ? state.errorMessage || "任务执行失败"
          : state.status === "completed"
            ? "任务已完成。"
            : "正在处理中..."
      ) }],
      thought: state.thoughtText || "",
      citations: Array.isArray(state.citations) && state.citations.length > 0 ? state.citations : null,
      searchContextTokens: Number.isFinite(state.searchContextTokens) && state.searchContextTokens > 0
        ? state.searchContextTokens
        : null,
      thinkingTimeline: Array.isArray(state.timeline) ? state.timeline : [],
      councilExperts: Array.isArray(state.councilExperts) && state.councilExperts.length > 0 ? state.councilExperts : null,
      councilExpertStates: Array.isArray(state.councilExpertStates) && state.councilExpertStates.length > 0 ? state.councilExpertStates : null,
      councilSummaryState: state.councilSummaryState || null,
    },
  });
}

function mergeTimelineStep(list, step) {
  const next = Array.isArray(list) ? list.slice() : [];
  const stepId = typeof step?.id === "string" ? step.id : "";
  if (stepId) {
    const index = next.findIndex((item) => item?.id === stepId);
    if (index >= 0) {
      next[index] = { ...next[index], ...step };
      return next;
    }
  }
  next.push(step);
  return next;
}

function upsertCouncilExpertState(list, nextState) {
  const next = Array.isArray(list) ? list.slice() : [];
  const key = nextState?.key || nextState?.modelId;
  if (!key) return next;
  const index = next.findIndex((item) => item?.key === key);
  if (index >= 0) {
    next[index] = { ...next[index], ...nextState, key };
    return next;
  }
  next.push({ ...nextState, key });
  return next;
}

export function normalizeInternalHeaders(inheritedHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (inheritedHeaders.cookie) {
    headers.cookie = inheritedHeaders.cookie;
  }
  return headers;
}

async function parseSseResponse(response, onEvent) {
  if (!response.ok) {
    let message = response.statusText || "请求失败";
    try {
      const data = await response.json();
      if (typeof data?.error === "string" && data.error) {
        message = data.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("服务端未返回可读取的数据流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");
      await onEvent(payload);
    }
  }
}

export async function executeChatRunById(runId, requestHeaders = {}) {
  let run = await ChatRun.findById(runId);
  if (!run) return;
  if (run.status === "cancelled" || run.status === "completed") return;

  run = await syncChatRunSnapshot({
    run,
    patch: {
      status: "running",
      phase: run.provider === "council" ? "triage" : "running",
      errorMessage: "",
    },
    conversationPatch: {},
  });
  if (!run) return;

  const baseUrl = buildBaseUrl(requestHeaders);
  const path = resolveRoutePath(run.model);
  const body = {
    prompt: run.promptSnapshot || "",
    model: run.model,
    config: run.configSnapshot || {},
    history: Array.isArray(run.historySnapshot) ? run.historySnapshot : [],
    messages: Array.isArray(run.messagesSnapshot) ? run.messagesSnapshot : [],
    historyLimit: Number.isFinite(run.historyLimit) ? run.historyLimit : 0,
    conversationId: run.conversationId?.toString?.() || String(run.conversationId || ""),
    settings: run.settingsSnapshot || undefined,
    modelMessageId: run.messageId,
    executionMode: "background",
    skipConversationWrite: true,
    ...(run.mode === "regenerate" ? { mode: "regenerate" } : {}),
  };

  const state = {
    status: "running",
    phase: run.provider === "council" ? "triage" : "running",
    outputText: "",
    thoughtText: "",
    citations: [],
    searchContextTokens: 0,
    timeline: [],
    councilExperts: [],
    councilExpertStates: [],
    councilSummaryState: null,
    errorMessage: "",
    lastPersistAt: 0,
  };

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: normalizeInternalHeaders(requestHeaders),
      body: JSON.stringify(body),
      cache: "no-store",
    });

    await parseSseResponse(response, async (payload) => {
      if (!payload || payload === "[DONE]") {
        state.status = "completed";
        state.phase = "completed";
        run = await persistChatRunSnapshot(run, state, true);
        if (run?.status === "cancelled") {
          throw new Error("__CHAT_RUN_CANCELLED__");
        }
        return;
      }

      let data = null;
      try {
        data = JSON.parse(payload);
      } catch {
        return;
      }

      if (data.type === "text") {
        const delta = typeof data.content === "string" ? data.content : "";
        if (delta) {
          state.outputText += delta;
          state.phase = "answering";
        }
      } else if (data.type === "thought") {
        const delta = typeof data.content === "string" ? data.content : "";
        if (delta) {
          state.thoughtText += delta;
          state.phase = "thinking";
        }
      } else if (data.type === "citations") {
        state.citations = Array.isArray(data.citations) ? data.citations : [];
      } else if (data.type === "search_context_tokens") {
        state.searchContextTokens = Number.isFinite(data.tokens) ? data.tokens : 0;
      } else if (data.type === "search_start") {
        state.phase = "searching";
        state.timeline = mergeTimelineStep(state.timeline, {
          id: `search_${data.round || Date.now()}`,
          kind: "search",
          status: "running",
          query: data.query || "",
          title: "联网搜索中",
        });
      } else if (data.type === "search_result") {
        state.phase = "thinking";
        state.timeline = mergeTimelineStep(state.timeline, {
          id: `search_${data.round || Date.now()}`,
          kind: "search",
          status: "done",
          query: data.query || "",
          title: "联网搜索完成",
          resultCount: Array.isArray(data.results) ? data.results.length : 0,
        });
      } else if (data.type === "search_error") {
        state.phase = "thinking";
        state.timeline = mergeTimelineStep(state.timeline, {
          id: `search_error_${data.round || Date.now()}`,
          kind: "search",
          status: "error",
          query: data.query || "",
          title: "联网搜索失败",
          message: data.message || "联网搜索失败",
        });
      } else if (data.type === "agent_step") {
        if (data.step && typeof data.step === "object") {
          state.timeline = mergeTimelineStep(state.timeline, {
            id: typeof data.step.id === "string" ? data.step.id : `agent_step_${Date.now()}`,
            kind: data.step.kind || "tool",
            status: data.step.status || "done",
            title: data.step.title || "",
            content: data.step.content || "",
            message: data.step.message || "",
            query: data.step.query || "",
          });
        }
      } else if (data.type === "council_experts") {
        state.councilExperts = Array.isArray(data.experts) ? data.experts : [];
      } else if (data.type === "council_expert_result") {
        if (data.expert && typeof data.expert === "object") {
          const index = state.councilExperts.findIndex((item) => item?.label === data.expert.label);
          if (index >= 0) {
            const next = state.councilExperts.slice();
            next[index] = data.expert;
            state.councilExperts = next;
          } else {
            state.councilExperts = [...state.councilExperts, data.expert];
          }
        }
      } else if (data.type === "council_expert_states") {
        state.councilExpertStates = Array.isArray(data.experts) ? data.experts : [];
        state.phase = "thinking";
      } else if (data.type === "council_expert_state") {
        if (data.expert && typeof data.expert === "object") {
          state.councilExpertStates = upsertCouncilExpertState(state.councilExpertStates, data.expert);
          state.phase = "thinking";
        }
      } else if (data.type === "council_summary_state") {
        state.councilSummaryState = data.summary && typeof data.summary === "object" ? data.summary : null;
        state.phase = data?.summary?.phase || "thinking";
      } else if (data.type === "stream_error") {
        throw new Error(data.message || "任务执行失败");
      }

      run = await persistChatRunSnapshot(run, state, false);
      if (run?.status === "cancelled") {
        throw new Error("__CHAT_RUN_CANCELLED__");
      }
    });
  } catch (error) {
    if (error?.message === "__CHAT_RUN_CANCELLED__") {
      return;
    }
    await failChatRun(run, error?.message || "任务执行失败");
  }
}

export async function executeAgentRunInBackground({
  conversationId,
  userId,
  messageId,
  prompt,
  history,
  historyLimit,
  config,
  requestHeaders = {},
}) {
  try {
    const baseUrl = buildBaseUrl(requestHeaders);
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers: normalizeInternalHeaders(requestHeaders),
      body: JSON.stringify({
        prompt,
        model: AGENT_MODEL_ID,
        config,
        history,
        historyLimit,
        conversationId,
        modelMessageId: messageId,
        executionMode: "background",
        skipConversationWrite: true,
      }),
      cache: "no-store",
    });

    const state = {
      content: "",
      thought: "",
      citations: [],
      timeline: [],
      councilExperts: [],
      councilExpertStates: [],
      councilSummaryState: null,
      agentRun: {
        runId: "",
        status: "running",
        executionState: "planning",
        currentStep: "准备执行",
        canResume: false,
        updatedAt: new Date().toISOString(),
      },
    };
    let lastPersistAt = 0;

    await parseSseResponse(response, async (payload) => {
      if (!payload || payload === "[DONE]") {
        state.agentRun = {
          ...state.agentRun,
          updatedAt: new Date().toISOString(),
        };
        await updateAgentConversationPlaceholder({
          conversationId,
          userId,
          messageId,
          content: state.content,
          thought: state.thought,
          citations: state.citations,
          timeline: state.timeline,
          councilExperts: state.councilExperts,
          councilExpertStates: state.councilExpertStates,
          councilSummaryState: state.councilSummaryState,
          agentRun: state.agentRun,
        });
        return;
      }

      let data = null;
      try {
        data = JSON.parse(payload);
      } catch {
        return;
      }
      if (data.type === "text") {
        const delta = typeof data.content === "string" ? data.content : "";
        if (delta) state.content += delta;
      } else if (data.type === "thought") {
        const delta = typeof data.content === "string" ? data.content : "";
        if (delta) state.thought += delta;
      } else if (data.type === "citations") {
        state.citations = Array.isArray(data.citations) ? data.citations : [];
      } else if (data.type === "agent_step") {
        if (data.step && typeof data.step === "object") {
          state.timeline = mergeTimelineStep(state.timeline, {
            id: typeof data.step.id === "string" ? data.step.id : `agent_step_${Date.now()}`,
            kind: data.step.kind || "tool",
            status: data.step.status || "done",
            title: data.step.title || "",
            content: data.step.content || "",
            message: data.step.message || "",
            query: data.step.query || "",
          });
        }
      } else if (data.type === "agent_status") {
        state.agentRun = {
          ...(state.agentRun || {}),
          ...buildAgentMessageMeta({
            _id: data.runId || state.agentRun.runId,
            status: data.status || state.agentRun.status,
            executionState: data.executionState || state.agentRun.executionState,
            currentStep: data.currentStep || state.agentRun.currentStep,
            lastError: data.lastError || "",
            approvalRequest: {
              reason: data.approvalReason || "",
              status: data.approvalStatus || "",
            },
            artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
            citations: Array.isArray(data.citations) ? data.citations : [],
            sandboxSession: data?.sandboxSession || null,
            updatedAt: new Date(),
          }, {
            canResume: data.canResume === true,
            executionState: data.executionState || state.agentRun.executionState || "running",
          }),
        };
      } else if (data.type === "search_start") {
        state.timeline = mergeTimelineStep(state.timeline, {
          id: `search_${data.round || Date.now()}`,
          kind: "search",
          status: "running",
          query: data.query || "",
          title: "联网搜索中",
        });
      } else if (data.type === "search_result") {
        state.timeline = mergeTimelineStep(state.timeline, {
          id: `search_${data.round || Date.now()}`,
          kind: "search",
          status: "done",
          query: data.query || "",
          title: "联网搜索完成",
          resultCount: Array.isArray(data.results) ? data.results.length : 0,
        });
      } else if (data.type === "search_error") {
        state.timeline = mergeTimelineStep(state.timeline, {
          id: `search_error_${data.round || Date.now()}`,
          kind: "search",
          status: "error",
          query: data.query || "",
          title: "联网搜索失败",
          message: data.message || "联网搜索失败",
        });
      } else if (data.type === "stream_error") {
        state.agentRun = {
          ...(state.agentRun || {}),
          status: "failed",
          executionState: "failed",
          lastError: data.message || "任务执行失败",
          failureReason: data.message || "任务执行失败",
          updatedAt: new Date().toISOString(),
        };
        state.content = data.message || "任务执行失败";
      }

      if (shouldPersistSnapshot(lastPersistAt)) {
        lastPersistAt = Date.now();
        await updateAgentConversationPlaceholder({
          conversationId,
          userId,
          messageId,
          content: state.content,
          thought: state.thought,
          citations: state.citations,
          timeline: state.timeline,
          councilExperts: state.councilExperts,
          councilExpertStates: state.councilExpertStates,
          councilSummaryState: state.councilSummaryState,
          agentRun: state.agentRun,
        });
      }
    });
  } catch (error) {
    await writeAgentFailurePlaceholder({
      conversationId,
      userId,
      messageId,
      message: error?.message || "任务执行失败",
    });
  }
}

export async function resumeAgentRunInBackground({
  runId,
  conversationId,
  userId,
  messageId,
  requestHeaders = {},
}) {
  try {
    const baseUrl = buildBaseUrl(requestHeaders);
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers: normalizeInternalHeaders(requestHeaders),
      body: JSON.stringify({
        prompt: "",
        model: AGENT_MODEL_ID,
        config: {},
        history: [],
        historyLimit: 0,
        conversationId,
        runId,
        resume: true,
        mode: "continue",
        modelMessageId: messageId,
        executionMode: "background",
        skipConversationWrite: true,
      }),
      cache: "no-store",
    });

    const state = {
      content: "",
      thought: "",
      citations: [],
      timeline: [],
      councilExperts: [],
      councilExpertStates: [],
      councilSummaryState: null,
      agentRun: {
        runId,
        status: "running",
        executionState: "running",
        currentStep: "继续执行中",
        canResume: false,
        updatedAt: new Date().toISOString(),
      },
    };
    let lastPersistAt = 0;

    await parseSseResponse(response, async (payload) => {
      if (!payload || payload === "[DONE]") {
        await updateAgentConversationPlaceholder({
          conversationId,
          userId,
          messageId,
          content: state.content,
          thought: state.thought,
          citations: state.citations,
          timeline: state.timeline,
          councilExperts: state.councilExperts,
          councilExpertStates: state.councilExpertStates,
          councilSummaryState: state.councilSummaryState,
          agentRun: state.agentRun,
        });
        return;
      }

      let data = null;
      try {
        data = JSON.parse(payload);
      } catch {
        return;
      }

      if (data.type === "text") {
        const delta = typeof data.content === "string" ? data.content : "";
        if (delta) state.content += delta;
      } else if (data.type === "thought") {
        const delta = typeof data.content === "string" ? data.content : "";
        if (delta) state.thought += delta;
      } else if (data.type === "citations") {
        state.citations = Array.isArray(data.citations) ? data.citations : [];
      } else if (data.type === "agent_step") {
        if (data.step && typeof data.step === "object") {
          state.timeline = mergeTimelineStep(state.timeline, {
            id: typeof data.step.id === "string" ? data.step.id : `agent_step_${Date.now()}`,
            kind: data.step.kind || "tool",
            status: data.step.status || "done",
            title: data.step.title || "",
            content: data.step.content || "",
            message: data.step.message || "",
            query: data.step.query || "",
          });
        }
      } else if (data.type === "agent_status") {
        state.agentRun = {
          ...(state.agentRun || {}),
          runId: typeof data.runId === "string" ? data.runId : state.agentRun.runId,
          status: typeof data.status === "string" ? data.status : state.agentRun.status,
          executionState: typeof data.executionState === "string" ? data.executionState : state.agentRun.executionState,
          currentStep: typeof data.currentStep === "string" ? data.currentStep : state.agentRun.currentStep,
          canResume: data.canResume === true,
          lastError: typeof data.lastError === "string" ? data.lastError : "",
          approvalReason: typeof data.approvalReason === "string" ? data.approvalReason : "",
          approvalStatus: typeof data.approvalStatus === "string" ? data.approvalStatus : "",
          sandboxSession: data?.sandboxSession && typeof data.sandboxSession === "object"
            ? data.sandboxSession
            : state.agentRun?.sandboxSession,
          updatedAt: new Date().toISOString(),
        };
      } else if (data.type === "stream_error") {
        state.agentRun = {
          ...(state.agentRun || {}),
          status: "failed",
          executionState: "failed",
          lastError: data.message || "任务执行失败",
          failureReason: data.message || "任务执行失败",
          updatedAt: new Date().toISOString(),
        };
        state.content = data.message || "任务执行失败";
      }

      if (shouldPersistSnapshot(lastPersistAt)) {
        lastPersistAt = Date.now();
        await updateAgentConversationPlaceholder({
          conversationId,
          userId,
          messageId,
          content: state.content,
          thought: state.thought,
          citations: state.citations,
          timeline: state.timeline,
          councilExperts: state.councilExperts,
          councilExpertStates: state.councilExpertStates,
          councilSummaryState: state.councilSummaryState,
          agentRun: state.agentRun,
        });
      }
    });
  } catch (error) {
    await writeAgentFailurePlaceholder({
      conversationId,
      userId,
      messageId,
      runId,
      message: error?.message || "任务执行失败",
    });
  }
}
