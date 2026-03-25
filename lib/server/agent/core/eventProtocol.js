export const AgentRuntimeEventType = Object.freeze({
  agentRuntimeEnd: "agent_runtime_end",
  agentRuntimeInit: "agent_runtime_init",
  error: "error",
  stepComplete: "step_complete",
  stepStart: "step_start",
  streamChunk: "stream_chunk",
  streamEnd: "stream_end",
  streamStart: "stream_start",
  toolEnd: "tool_end",
  toolStart: "tool_start",
});

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function createAgentRuntimeEvent(type, data = {}, stepIndex = 0) {
  return {
    type,
    timestamp: new Date().toISOString(),
    stepIndex: Number.isFinite(stepIndex) ? stepIndex : 0,
    data: normalizeObject(data),
  };
}

export function createToolCall({ id, identifier, apiName, arguments: args, type = "builtin" }) {
  return {
    id: typeof id === "string" && id ? id : "",
    identifier: typeof identifier === "string" ? identifier : "",
    apiName: typeof apiName === "string" ? apiName : "",
    arguments: normalizeObject(args),
    type,
  };
}

export function createTimelineStep(step = {}) {
  return {
    id: typeof step.id === "string" ? step.id : "",
    kind: typeof step.kind === "string" ? step.kind : "thought",
    status: typeof step.status === "string" ? step.status : "done",
    title: typeof step.title === "string" ? step.title : "",
    content: typeof step.content === "string" ? step.content : "",
    message: typeof step.message === "string" ? step.message : "",
    query: typeof step.query === "string" ? step.query : "",
    url: typeof step.url === "string" ? step.url : "",
    round: Number.isFinite(step.round) ? step.round : null,
    resultCount: Number.isFinite(step.resultCount) ? step.resultCount : null,
    synthetic: step.synthetic === true,
  };
}

export function createStreamDescriptor(stream = {}) {
  return {
    id: typeof stream.id === "string" && stream.id ? stream.id : "",
    channel: typeof stream.channel === "string" ? stream.channel : "answer",
    label: typeof stream.label === "string" ? stream.label : "",
  };
}
