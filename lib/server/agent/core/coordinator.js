import {
  AgentRuntimeEventType,
  createAgentRuntimeEvent,
  createStreamDescriptor,
  createTimelineStep,
} from "@/lib/server/agent/core/eventProtocol";

function clipText(text, maxLength = 600) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function upsertById(list, entry) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (!entry?.id) {
    next.push(entry);
    return next;
  }
  const index = next.findIndex((item) => item?.id === entry.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...entry };
    return next;
  }
  next.push(entry);
  return next;
}

function mergeCitations(target, items) {
  const list = Array.isArray(target) ? target.slice() : [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.url) continue;
    if (!list.some((citation) => citation.url === item.url)) {
      list.push(item);
    }
  }
  return list;
}

function closeThoughtSteps(list) {
  return (Array.isArray(list) ? list : []).map((item) => {
    if (item?.kind === "thought" && item?.status === "streaming") {
      return { ...item, status: "done" };
    }
    return item;
  });
}

export class AgentRuntimeCoordinator {
  constructor({ conversationId, driverModel, prompt, sendEvent }) {
    this.runtimeId = createId("agent_runtime");
    this.conversationId = conversationId;
    this.driverModel = driverModel;
    this.prompt = prompt;
    this.sendEvent = typeof sendEvent === "function" ? sendEvent : () => {};
    this.stepIndex = 0;
    this.activeStepIndex = 0;
    this.streams = new Map();
    this.state = {
      artifacts: [],
      citations: [],
      content: "",
      prompt,
      searchContextTokens: 0,
      thinkingTimeline: [],
      thought: "",
      tools: [],
    };
  }

  emit(type, data = {}, stepIndex = this.activeStepIndex) {
    this.sendEvent(createAgentRuntimeEvent(type, data, stepIndex));
  }

  init() {
    this.emit(AgentRuntimeEventType.agentRuntimeInit, {
      conversationId: this.conversationId,
      driverModel: this.driverModel,
      prompt: this.prompt,
      runtimeId: this.runtimeId,
    }, 0);
  }

  startStep(step = {}) {
    this.stepIndex += 1;
    this.activeStepIndex = this.stepIndex;
    const nextStep = createTimelineStep({
      ...step,
      id: typeof step.id === "string" && step.id ? step.id : createId("step"),
      status: "running",
    });
    this.state.thinkingTimeline = upsertById(this.state.thinkingTimeline, nextStep);
    this.emit(AgentRuntimeEventType.stepStart, { step: nextStep }, this.activeStepIndex);
    return nextStep;
  }

  completeStep(stepId, patch = {}) {
    const existing = this.state.thinkingTimeline.find((item) => item?.id === stepId) || {};
    const nextStep = createTimelineStep({
      ...existing,
      ...patch,
      id: stepId,
      status: typeof patch.status === "string" ? patch.status : "done",
    });
    this.state.thinkingTimeline = upsertById(this.state.thinkingTimeline, nextStep);
    this.emit(AgentRuntimeEventType.stepComplete, { step: nextStep }, this.activeStepIndex);
    return nextStep;
  }

  startStream(stream = {}) {
    const descriptor = createStreamDescriptor({
      ...stream,
      id: typeof stream.id === "string" && stream.id ? stream.id : createId("stream"),
    });
    this.streams.set(descriptor.channel, descriptor);
    this.emit(AgentRuntimeEventType.streamStart, { stream: descriptor }, this.activeStepIndex);
    return descriptor;
  }

  appendStreamChunk({ channel, content }) {
    if (typeof content !== "string" || !content) return;

    const descriptor = this.streams.get(channel) || this.startStream({ channel });
    if (channel === "answer") {
      this.state.content += content;
    } else if (channel === "reasoning") {
      this.state.thought += content;
      this.state.thinkingTimeline = this.appendThoughtDelta(content);
    }

    this.emit(AgentRuntimeEventType.streamChunk, {
      channel,
      content,
      streamId: descriptor.id,
    }, this.activeStepIndex);
  }

  appendThoughtDelta(delta) {
    const base = Array.isArray(this.state.thinkingTimeline) ? this.state.thinkingTimeline : [];
    if (base.length > 0) {
      const last = base[base.length - 1];
      if (last?.kind === "thought" && last?.status === "streaming") {
        const next = base.slice();
        next[next.length - 1] = {
          ...last,
          content: `${typeof last.content === "string" ? last.content : ""}${delta}`,
          synthetic: false,
        };
        return next;
      }
    }

    return [
      ...base,
      createTimelineStep({
        id: createId("thought"),
        kind: "thought",
        status: "streaming",
        content: delta,
        synthetic: false,
      }),
    ];
  }

  endStream(channel) {
    const descriptor = this.streams.get(channel);
    if (!descriptor) return;
    if (channel === "reasoning") {
      this.state.thinkingTimeline = closeThoughtSteps(this.state.thinkingTimeline);
    }
    this.emit(AgentRuntimeEventType.streamEnd, {
      channel,
      streamId: descriptor.id,
    }, this.activeStepIndex);
    this.streams.delete(channel);
  }

  pushCitations(items) {
    this.state.citations = mergeCitations(this.state.citations, items);
  }

  setSearchContextTokens(tokens) {
    if (Number.isFinite(tokens) && tokens > 0) {
      this.state.searchContextTokens = Math.max(0, Math.floor(tokens));
    }
  }

  startTool(toolCall, view = {}) {
    const entry = {
      ...toolCall,
      status: "running",
      title: typeof view.title === "string" ? view.title : "",
      summary: typeof view.summary === "string" ? view.summary : "",
      startedAt: new Date().toISOString(),
    };
    this.state.tools = upsertById(this.state.tools, entry);
    this.emit(AgentRuntimeEventType.toolStart, { toolCall: entry }, this.activeStepIndex);
    return entry;
  }

  finishTool(toolCallId, toolRun = {}) {
    const existing = this.state.tools.find((item) => item?.id === toolCallId) || {};
    const nextTool = {
      ...existing,
      ...toolRun,
      id: toolCallId,
      status: typeof toolRun.status === "string" ? toolRun.status : (toolRun.success === false ? "error" : "success"),
      finishedAt: new Date().toISOString(),
    };
    this.state.tools = upsertById(this.state.tools, nextTool);
    this.pushCitations(nextTool.citations);
    if (Array.isArray(nextTool.artifacts) && nextTool.artifacts.length > 0) {
      const seen = new Set(this.state.artifacts.map((item) => item?.url).filter(Boolean));
      for (const artifact of nextTool.artifacts) {
        if (!artifact?.url || seen.has(artifact.url)) continue;
        seen.add(artifact.url);
        this.state.artifacts.push(artifact);
      }
    }
    this.emit(AgentRuntimeEventType.toolEnd, { toolRun: nextTool }, this.activeStepIndex);
    return nextTool;
  }

  fail(error, phase = "") {
    this.endStream("reasoning");
    this.endStream("answer");
    this.emit(AgentRuntimeEventType.error, {
      message: error?.message || "Unknown error",
      phase,
      runtimeId: this.runtimeId,
    }, this.activeStepIndex);
  }

  finish() {
    this.endStream("reasoning");
    this.endStream("answer");
    this.emit(AgentRuntimeEventType.agentRuntimeEnd, {
      runtimeId: this.runtimeId,
      state: {
        artifacts: this.state.artifacts,
        citations: this.state.citations,
        searchContextTokens: this.state.searchContextTokens,
        tools: this.state.tools,
      },
      status: "completed",
      textPreview: clipText(this.state.content, 600),
    }, this.activeStepIndex);
    return this.state;
  }

  getState() {
    return {
      ...this.state,
      artifacts: Array.isArray(this.state.artifacts) ? this.state.artifacts.slice() : [],
      citations: Array.isArray(this.state.citations) ? this.state.citations.slice() : [],
      thinkingTimeline: Array.isArray(this.state.thinkingTimeline) ? this.state.thinkingTimeline.slice() : [],
      tools: Array.isArray(this.state.tools) ? this.state.tools.slice() : [],
    };
  }
}
