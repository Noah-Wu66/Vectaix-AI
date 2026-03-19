import MemoryEntry from "@/models/MemoryEntry";
import { parseJsonFromText } from "@/app/api/chat/jsonUtils";
import { buildWebSearchDecisionPrompts, runWebSearchOrchestration } from "@/app/api/chat/webSearchOrchestrator";
import { buildBytedanceInputFromHistory, buildSeedMessageInput } from "@/app/api/bytedance/bytedanceHelpers";
import {
  fetchImageAsBase64,
  injectCurrentTimeSystemReminder,
  isNonEmptyString,
} from "@/app/api/chat/utils";
import {
  buildAttachmentTextBlock,
  getPreparedAttachmentTextsByUrls,
  loadBlobFileByUser,
  prepareDocumentAttachment,
} from "@/lib/server/files/service";
import { WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS, getWebSearchProviderRuntimeOptions } from "@/lib/server/chat/webSearchConfig";
import { parseWebSearchEnabled } from "@/lib/server/chat/requestConfig";
import { resolveSeedRuntimeModelId, SEED_MODEL_ID } from "@/lib/shared/models";
import {
  buildSeedJsonRequestBody,
  buildSeedRequestBody,
  normalizeSeedChunkText,
  requestSeedJson,
  requestSeedResponses,
} from "@/lib/server/seed/service";
import {
  createOrConnectSandbox,
  downloadSandboxArtifactToBlob,
  readSandboxFile,
  runSandboxCommand,
  writeSandboxFile,
} from "@/lib/server/sandbox/vercelSandbox";

const AGENT_PLAN_MAX_TOKENS = 1200;
const AGENT_FINAL_MAX_TOKENS = 32000;
const AGENT_MEMORY_MAX_ITEMS = 5;
const AGENT_ATTACHMENT_MAX_CHARS = 12000;
const AGENT_ATTACHMENT_TOTAL_MAX_CHARS = 36000;
const AGENT_HISTORY_SUMMARY_LIMIT = 8;
const AGENT_TOOL_LOOP_MAX_ROUNDS = 4;
const AGENT_TOOL_RESULT_MAX_ITEMS = 10;
const AGENT_TOOL_RESULT_MAX_CHARS = 2400;

function clipText(text, maxLength) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" ? signal.reason : "Request aborted");
}

function summarizeHistoryMessages(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length === 0) return "(无最近历史)";
  return historyMessages
    .slice(-AGENT_HISTORY_SUMMARY_LIMIT)
    .map((message) => {
      const role = message?.role === "model" ? "AI" : "用户";
      const text = typeof message?.content === "string" && message.content.trim()
        ? message.content.trim()
        : Array.isArray(message?.parts)
          ? message.parts.map((part) => (typeof part?.text === "string" ? part.text.trim() : "")).filter(Boolean).join("\n")
          : "";
      if (!text) return null;
      return `${role}：${clipText(text, 400)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function countPlannableAttachments(historyMessages, currentAttachments) {
  const urls = new Set();
  for (const item of Array.isArray(currentAttachments) ? currentAttachments : []) {
    if (typeof item?.url === "string" && item.url) urls.add(item.url);
  }
  for (const message of Array.isArray(historyMessages) ? historyMessages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (typeof part?.fileData?.url === "string" && part.fileData.url) urls.add(part.fileData.url);
    }
  }
  return urls.size;
}

function buildPlannerFallback({ prompt, attachmentCount, enableWebSearch }) {
  const normalizedPrompt = typeof prompt === "string" ? prompt : "";
  const shouldSearch = enableWebSearch === true && /最新|最近|当前|现在|今天|实时|官网|官方文档|官方说明|文档|教程|资料|来源|新闻|公告|价格|股价|汇率|天气|发布时间|发布日期|更新|版本|进展|状态|兼容|支持吗|收费|定价|套餐|api|sdk|查一下|搜一下|搜索|检索|联网|上网/u.test(normalizedPrompt);
  const shouldUseMemory = /继续|接着|上次|之前|刚才/u.test(normalizedPrompt);
  const shouldUseSandbox = /代码|脚本|命令|终端|shell|bash|powershell|python|node|运行|执行|调试|报错|修复|文件|目录|日志|输出|生成文件/u.test(normalizedPrompt);
  return {
    planTitle: "处理当前 Agent 任务",
    shouldReadAttachments: attachmentCount > 0,
    shouldSearch,
    shouldUseMemory,
    shouldUseSandbox,
    outputStyle: "用简体中文，大白话，结论优先。",
    steps: [
      "理解任务目标",
      attachmentCount > 0 ? "读取附件资料" : null,
      shouldSearch ? "联网补充信息" : null,
      shouldUseSandbox ? "在沙盒里同步执行必要操作" : null,
      "整理并输出结果",
    ].filter(Boolean),
  };
}

function normalizePlannerDecision(parsed, fallback) {
  const base = parsed && typeof parsed === "object" ? parsed : {};
  const steps = Array.isArray(base.steps)
    ? base.steps.filter((item) => typeof item === "string" && item.trim()).slice(0, 6)
    : [];
  return {
    planTitle: typeof base.planTitle === "string" && base.planTitle.trim() ? base.planTitle.trim() : fallback.planTitle,
    shouldReadAttachments: base.shouldReadAttachments === true || fallback.shouldReadAttachments === true,
    shouldSearch: base.shouldSearch === true || fallback.shouldSearch === true,
    shouldUseMemory: base.shouldUseMemory === true || fallback.shouldUseMemory === true,
    shouldUseSandbox: base.shouldUseSandbox === true || fallback.shouldUseSandbox === true,
    outputStyle: typeof base.outputStyle === "string" && base.outputStyle.trim() ? base.outputStyle.trim() : fallback.outputStyle,
    steps: steps.length > 0 ? steps : fallback.steps,
  };
}

function buildPlannerPrompt({ prompt, historyMessages, attachmentCount, enableWebSearch }) {
  return [
    "请把当前任务判断成一个同步执行的 Agent 计划，严格只返回 JSON。",
    "JSON 字段必须包含：planTitle、shouldReadAttachments、shouldSearch、shouldUseMemory、shouldUseSandbox、outputStyle、steps。",
    "steps 必须是 2 到 6 个简短中文步骤数组。",
    "不要设计后台任务、不要设计等待审批、不要设计继续执行、不要设计恢复断点。",
    "只有当前这次请求里能当场做完的事情才允许放进计划。",
    "如果用户问题有明显时效性、联网才能更准，shouldSearch 设为 true。",
    "如果用户问题明显涉及代码、命令、文件处理、日志排查、生成文件，shouldUseSandbox 设为 true。",
    `当前消息：${prompt || "(空)"}`,
    `最近对话：\n${summarizeHistoryMessages(historyMessages)}`,
    `当前附件数量：${attachmentCount}`,
    `当前是否允许联网：${enableWebSearch === true ? "是" : "否"}`,
  ].join("\n\n");
}

async function buildPlannerDecision({ apiKey, req, prompt, historyMessages, attachmentCount, enableWebSearch, thinkingLevel }) {
  const fallback = buildPlannerFallback({ prompt, attachmentCount, enableWebSearch });
  try {
    const requestBody = buildSeedJsonRequestBody({
      model: SEED_MODEL_ID,
      input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: buildPlannerPrompt({ prompt, historyMessages, attachmentCount, enableWebSearch }) }] })],
      instructions: await injectCurrentTimeSystemReminder("你是一个同步 Agent 的任务规划器。请严格输出 JSON，不要输出解释。"),
      maxTokens: AGENT_PLAN_MAX_TOKENS,
      thinkingLevel,
    });
    const result = await requestSeedJson({ apiKey, requestBody, req });
    const parsed = parseJsonFromText(result.text);
    return normalizePlannerDecision(parsed, fallback);
  } catch {
    return fallback;
  }
}

async function loadMemorySummaries(userId) {
  const entries = await MemoryEntry.find({ userId, scope: "agent" }).sort({ updatedAt: -1 }).limit(AGENT_MEMORY_MAX_ITEMS).lean();
  return entries.map((entry) => clipText(entry?.summary, 600)).filter(Boolean);
}

async function appendMemoryEntry({ userId, conversationId, summary }) {
  const finalSummary = clipText(summary, 1500);
  if (!finalSummary) return;
  await MemoryEntry.create({
    userId,
    scope: "agent",
    summary: finalSummary,
    sourceRef: {
      conversationId: conversationId?.toString?.() || String(conversationId || ""),
    },
    updatedAt: new Date(),
  });
}

function buildAttachmentContext(preparedAttachments) {
  const sections = [];
  let totalChars = 0;
  for (const item of Array.isArray(preparedAttachments) ? preparedAttachments : []) {
    const extractedText = clipText(item?.structuredText || item?.extractedText || "", AGENT_ATTACHMENT_MAX_CHARS);
    if (!extractedText) continue;
    const block = buildAttachmentTextBlock(item.file, extractedText);
    if (!block) continue;
    if (totalChars + block.length > AGENT_ATTACHMENT_TOTAL_MAX_CHARS) break;
    totalChars += block.length;
    sections.push(block);
  }
  return sections.join("\n\n");
}

function buildPreparedAttachmentSummary(prepared) {
  const file = prepared?.file || {};
  const parts = [`${file.name || "附件"}：已提取文本`];
  if (prepared?.sandboxPath) parts.push(`沙盒路径 ${prepared.sandboxPath}`);
  if (Number(prepared?.visualAssetCount) > 0) parts.push(`发现 ${prepared.visualAssetCount} 个视觉内容`);
  return parts.join("，");
}

function collectFileUrlsFromMessages(messages) {
  const urls = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (typeof part?.fileData?.url === "string" && part.fileData.url) {
        urls.push(part.fileData.url);
      }
    }
  }
  return Array.from(new Set(urls));
}

function buildToolResultsContext(toolResults) {
  const list = Array.isArray(toolResults) ? toolResults.slice(-AGENT_TOOL_RESULT_MAX_ITEMS) : [];
  if (list.length === 0) return "";
  return list
    .map((item, index) => [
      `工具结果 ${index + 1}`,
      item?.title ? `标题：${item.title}` : "",
      item?.summary ? `内容：${clipText(item.summary, AGENT_TOOL_RESULT_MAX_CHARS)}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

function buildAvailableAttachmentList(preparedAttachments) {
  const list = Array.isArray(preparedAttachments) ? preparedAttachments : [];
  if (list.length === 0) return "(无)";
  return list
    .map((item) => {
      const file = item?.file || {};
      return [
        `- 名称：${file.name || "附件"}`,
        file.url ? `  blobUrl：${file.url}` : "",
        item?.sandboxPath ? `  sandboxPath：${item.sandboxPath}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
}

function emitAgentStep(sendEvent, step) {
  sendEvent({ type: "agent_step", step });
}

function emitAgentThought(sendEvent, text) {
  if (isNonEmptyString(text)) sendEvent({ type: "thought", content: text });
}

async function buildCurrentUserInput({ prompt, images, preparedAttachments }) {
  const userContent = [];

  if (isNonEmptyString(prompt)) {
    userContent.push({ type: "input_text", text: prompt });
  }

  for (const image of Array.isArray(images) ? images : []) {
    if (!image?.url) continue;
    const { base64Data, mimeType } = await fetchImageAsBase64(image.url);
    userContent.push({
      type: "input_image",
      image_url: `data:${mimeType};base64,${base64Data}`,
    });
  }

  for (const prepared of Array.isArray(preparedAttachments) ? preparedAttachments : []) {
    const extractedText = prepared?.structuredText || prepared?.extractedText || "";
    if (!extractedText) continue;
    userContent.push({
      type: "input_text",
      text: buildAttachmentTextBlock(prepared.file, extractedText),
    });
  }

  return userContent;
}

async function runSeedDecision({ apiKey, req, prompt, historyMessages, searchRounds, thinkingLevel }) {
  const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages, searchRounds });
  const requestBody = buildSeedJsonRequestBody({
    model: SEED_MODEL_ID,
    input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: userText }] })],
    instructions: systemText,
    maxTokens: WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
    temperature: 0.1,
    thinkingLevel,
  });
  const result = await requestSeedJson({ apiKey, requestBody, req });
  return result.text;
}

function normalizeToolAction(rawAction) {
  const candidate = typeof rawAction === "string" ? parseJsonFromText(rawAction) : rawAction;
  if (!candidate || typeof candidate !== "object") {
    return { action: "final_answer", answer: "" };
  }

  if (candidate.action === "tool_call" && typeof candidate.tool === "string" && candidate.tool.trim()) {
    return {
      action: "tool_call",
      tool: candidate.tool.trim(),
      input: candidate.input && typeof candidate.input === "object" ? candidate.input : {},
    };
  }

  return {
    action: "final_answer",
    answer: typeof candidate.answer === "string" ? candidate.answer.trim() : "",
  };
}

function buildToolLoopPrompt({
  goal,
  plan,
  searchContextText,
  attachmentContext,
  preparedAttachments,
  sandboxSession,
  toolResults,
}) {
  return [
    "你是同步 Agent 的工具调度器，只能在当前请求里做完事情。",
    "严格只返回 JSON。",
    "可选动作如下：",
    '1. {"action":"tool_call","tool":"sandbox_exec","input":{"command":"ls -la","cwd":"/vercel/sandbox/vectaix"}}',
    '2. {"action":"tool_call","tool":"sandbox_upload","input":{"url":"https://...","remotePath":"/path/file.txt"}}',
    '3. {"action":"tool_call","tool":"sandbox_read_file","input":{"path":"/path/file.txt"}}',
    '4. {"action":"tool_call","tool":"sandbox_download_artifact","input":{"path":"/path/file.txt","title":"result","mimeType":"text/plain","extension":"txt"}}',
    '5. {"action":"final_answer","answer":"..."}',
    "禁止输出后台命令，禁止输出 approval，禁止输出 continue，禁止输出 resume。",
    "如果已经拿到足够信息，就直接返回 final_answer。",
    `用户任务：${goal}`,
    plan?.planTitle ? `计划：${plan.planTitle}` : "",
    attachmentContext ? `附件摘要：\n${attachmentContext}` : "",
    searchContextText ? `联网资料：\n${searchContextText}` : "",
    `当前附件可用信息：\n${buildAvailableAttachmentList(preparedAttachments)}`,
    sandboxSession?.workdir ? `当前沙盒工作目录：${sandboxSession.workdir}` : "当前还没有沙盒会话，如需执行工具可直接调用。",
    toolResults.length > 0 ? `最近工具结果：\n${buildToolResultsContext(toolResults)}` : "",
  ].filter(Boolean).join("\n\n");
}

async function requestToolAction({ apiKey, req, prompt, thinkingLevel }) {
  const requestBody = buildSeedJsonRequestBody({
    model: SEED_MODEL_ID,
    input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: prompt }] })],
    instructions: await injectCurrentTimeSystemReminder("你是 Vectaix Agent 的同步 JSON 工具调度器，只能输出 JSON。"),
    maxTokens: 900,
    temperature: 0.1,
    thinkingLevel,
  });
  const result = await requestSeedJson({ apiKey, requestBody, req });
  return normalizeToolAction(result.text);
}

async function executeToolCall({
  toolName,
  input,
  userId,
  conversationId,
  sandboxSession,
  signal,
}) {
  const ensured = await createOrConnectSandbox({
    userId,
    conversationId,
    existingSession: sandboxSession,
    allowInternetAccess: true,
  });
  const session = ensured.session;
  const sandbox = ensured.sandbox;

  if (toolName === "sandbox_exec") {
    const command = typeof input?.command === "string" ? input.command.trim() : "";
    if (!command) throw new Error("sandbox_exec 缺少 command");
    if (input?.background === true) {
      throw new Error("sandbox_exec 已禁止后台模式");
    }
    const cwd = typeof input?.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : session.workdir;
    const executed = await runSandboxCommand({ sandbox, session, command, cwd, signal });
    return {
      sandboxSession: {
        ...session,
        latestCommand: executed.result,
      },
      toolEvent: {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: "已执行沙盒命令",
        summary: clipText(`${command}\n退出码：${executed.result?.exitCode ?? "未知"}\n${executed.result?.stdout || executed.result?.stderr || ""}`, AGENT_TOOL_RESULT_MAX_CHARS),
      },
    };
  }

  if (toolName === "sandbox_upload") {
    const url = typeof input?.url === "string" ? input.url.trim() : "";
    if (!url) throw new Error("sandbox_upload 缺少 url");
    const blobFile = await loadBlobFileByUser({ userId, url });
    if (!blobFile) throw new Error("文件不存在或无权限访问");
    const response = await fetch(blobFile.url, { cache: "no-store", signal });
    if (!response.ok) throw new Error("文件下载失败");
    const remotePath = typeof input?.remotePath === "string" && input.remotePath.trim()
      ? input.remotePath.trim()
      : `${session.workdir}/uploads/${blobFile.originalName || "file"}`;
    await writeSandboxFile({
      sandbox,
      remotePath,
      content: Buffer.from(await response.arrayBuffer()),
    });
    return {
      sandboxSession: session,
      toolEvent: {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: "已上传文件到沙盒",
        summary: `${blobFile.originalName || "文件"} -> ${remotePath}`,
      },
    };
  }

  if (toolName === "sandbox_read_file") {
    const remotePath = typeof input?.path === "string" ? input.path.trim() : "";
    if (!remotePath) throw new Error("sandbox_read_file 缺少 path");
    const content = await readSandboxFile({ sandbox, remotePath });
    return {
      sandboxSession: session,
      toolEvent: {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: "已读取沙盒文件",
        summary: clipText(`${remotePath}\n${content.text || ""}`, AGENT_TOOL_RESULT_MAX_CHARS),
      },
    };
  }

  if (toolName === "sandbox_download_artifact") {
    const remotePath = typeof input?.path === "string" ? input.path.trim() : "";
    if (!remotePath) throw new Error("sandbox_download_artifact 缺少 path");
    const artifact = await downloadSandboxArtifactToBlob({
      sandbox,
      remotePath,
      userId,
      conversationId,
      title: typeof input?.title === "string" ? input.title.trim() : "artifact",
      mimeType: typeof input?.mimeType === "string" ? input.mimeType.trim() : "text/plain",
      extension: typeof input?.extension === "string" ? input.extension.trim() : "txt",
    });
    return {
      sandboxSession: session,
      toolEvent: {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: "已导出沙盒产物",
        summary: `${remotePath}\n已保存为：${artifact.url}`,
      },
    };
  }

  throw new Error(`不支持的工具：${toolName}`);
}

function buildFinalPrompt({
  goal,
  plan,
  memoryContext,
  attachmentContext,
  searchContextText,
  toolResultsContext,
}) {
  return [
    "你是 Vectaix 的 Agent，请基于当前请求内已经拿到的资料直接给出可交付结果。",
    "如果用户问你是谁、你是什么、你来自哪里，必须明确回答你是 Vectaix 的 Agent。",
    "要求：用简体中文，大白话，结论优先；如果用了联网信息，要尽量体现来源；如果资料不足，要明确说不确定。",
    "禁止编造你没有看到的工具结果，禁止说自己会在后台继续执行。",
    `用户任务：${goal}`,
    plan?.planTitle ? `执行计划：${plan.planTitle}` : "",
    memoryContext ? `会话记忆：\n${memoryContext}` : "",
    attachmentContext ? `附件资料：\n${attachmentContext}` : "",
    searchContextText ? `联网资料：\n${searchContextText}` : "",
    toolResultsContext ? `沙盒结果：\n${toolResultsContext}` : "",
  ].filter(Boolean).join("\n\n");
}

async function streamSeedAnswer({
  apiKey,
  req,
  model,
  historyMessages,
  prompt,
  images,
  preparedAttachments,
  userId,
  instructions,
  thinkingLevel,
  sendEvent,
}) {
  const historyFileTextMap = await getPreparedAttachmentTextsByUrls(collectFileUrlsFromMessages(historyMessages), { userId });
  const input = await buildBytedanceInputFromHistory(historyMessages, { fileTextMap: historyFileTextMap });
  const currentUserInput = await buildCurrentUserInput({ prompt, images, preparedAttachments });
  const currentUserMessage = buildSeedMessageInput({ role: "user", content: currentUserInput });
  if (currentUserMessage) input.push(currentUserMessage);

  const requestBody = buildSeedRequestBody({
    model: resolveSeedRuntimeModelId(model),
    input,
    instructions,
    maxTokens: AGENT_FINAL_MAX_TOKENS,
    thinkingLevel,
  });

  const response = await requestSeedResponses({ apiKey, requestBody, req });
  if (!response.body) {
    throw new Error("Seed 官方接口返回了空响应体，请稍后重试");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const handleEvent = (event) => {
    const eventType = typeof event?.type === "string" ? event.type : "";

    if (eventType === "response.output_text.delta") {
      const text = normalizeSeedChunkText(event?.delta);
      if (!text) return;
      fullText += text;
      sendEvent({ type: "text", content: text });
      return;
    }

    if (eventType === "response.reasoning.delta" || eventType === "response.reasoning_summary_text.delta") {
      const thought = normalizeSeedChunkText(event?.delta);
      if (!thought) return;
      sendEvent({ type: "thought", content: thought });
    }
  };

  const consumeSseBuffer = (final = false) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (blocks.pop() || "");

    for (const block of blocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;

      const lines = trimmedBlock.split(/\r?\n/);
      const dataLines = [];
      for (const line of lines) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^\s*/, ""));
        }
      }

      if (!dataLines.length) continue;
      const dataStr = dataLines.join("\n");
      if (dataStr === "[DONE]") continue;

      try {
        handleEvent(JSON.parse(dataStr));
      } catch { }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    throwIfAborted(req?.signal);
    buffer += decoder.decode(value, { stream: true });
    consumeSseBuffer(false);
  }

  buffer += decoder.decode();
  consumeSseBuffer(true);
  return fullText;
}

export async function runAgentRuntimeV2({
  apiKey,
  req,
  userId,
  conversationId,
  model,
  prompt,
  historyMessages = [],
  config = {},
  attachments = [],
  images = [],
  sendEvent,
}) {
  const goal = isNonEmptyString(prompt) ? prompt.trim() : "请处理当前任务";
  const thinkingLevel = typeof config?.thinkingLevel === "string" && config.thinkingLevel
    ? config.thinkingLevel
    : "high";
  const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

  let citations = [];
  let searchContextText = "";
  let preparedAttachments = [];
  let sandboxSession = null;
  let toolResults = [];

  emitAgentThought(sendEvent, "正在理解这次任务...\n");

  const plan = await buildPlannerDecision({
    apiKey,
    req,
    prompt: goal,
    historyMessages,
    attachmentCount: countPlannableAttachments(historyMessages, attachments),
    enableWebSearch,
    thinkingLevel,
  });

  emitAgentStep(sendEvent, {
    id: `agent_plan_${Date.now()}`,
    kind: "planner",
    status: "done",
    title: "已确定执行计划",
    content: [plan.planTitle, ...(Array.isArray(plan.steps) ? plan.steps.map((step, index) => `${index + 1}. ${step}`) : [])].join("\n"),
  });

  const memorySummaries = plan.shouldUseMemory ? await loadMemorySummaries(userId) : [];
  const memoryContext = memorySummaries.length > 0
    ? memorySummaries.map((item, index) => `记忆 ${index + 1}：${item}`).join("\n")
    : "";

  if (plan.shouldReadAttachments && Array.isArray(attachments) && attachments.length > 0) {
    emitAgentStep(sendEvent, {
      id: `agent_attachment_${Date.now()}_start`,
      kind: "reader",
      status: "running",
      title: "正在读取附件资料",
      content: `${attachments.length} 个附件`,
    });
    emitAgentThought(sendEvent, "正在读取附件里的内容...\n");

    for (const attachment of attachments) {
      throwIfAborted(req?.signal);
      if (!attachment?.url) continue;
      const prepared = await prepareDocumentAttachment({
        userId,
        url: attachment.url,
        signal: req?.signal,
      });
      if (prepared?.prepared) {
        preparedAttachments.push(prepared.prepared);
      }
    }

    emitAgentStep(sendEvent, {
      id: `agent_attachment_${Date.now()}_done`,
      kind: "reader",
      status: "done",
      title: "附件资料已读取",
      content: preparedAttachments.length > 0
        ? preparedAttachments.map(buildPreparedAttachmentSummary).join("\n")
        : "没有读取到可用附件内容",
    });
  }

  if (plan.shouldSearch && enableWebSearch === true) {
    emitAgentThought(sendEvent, "正在联网补充信息...\n");
    const citationList = [];
    const searchResult = await runWebSearchOrchestration({
      enableWebSearch: true,
      prompt: goal,
      historyMessages,
      decisionRunner: ({ prompt: decisionPrompt, historyMessages: decisionHistory, searchRounds }) =>
        runSeedDecision({
          apiKey,
          req,
          prompt: decisionPrompt,
          historyMessages: decisionHistory,
          searchRounds,
          thinkingLevel,
        }),
      sendEvent,
      pushCitations: (items) => {
        for (const item of Array.isArray(items) ? items : []) {
          if (!item?.url) continue;
          if (!citationList.some((citation) => citation.url === item.url)) {
            citationList.push(item);
          }
        }
      },
      sendSearchError: (message, details = {}) => sendEvent({ type: "search_error", message, ...details }),
      isClientAborted: () => req?.signal?.aborted === true,
      model: resolveSeedRuntimeModelId(model),
      conversationId: conversationId?.toString?.() || "",
      signal: req?.signal,
      ...getWebSearchProviderRuntimeOptions("seed"),
    });
    citations = citationList;
    searchContextText = searchResult?.searchContextText || "";
  }

  if (plan.shouldUseSandbox) {
    emitAgentStep(sendEvent, {
      id: `agent_tool_${Date.now()}_start`,
      kind: "tool",
      status: "running",
      title: "正在执行同步沙盒操作",
      content: "只会执行当前请求里能完成的操作",
    });

    for (let round = 0; round < AGENT_TOOL_LOOP_MAX_ROUNDS; round += 1) {
      throwIfAborted(req?.signal);
      const action = await requestToolAction({
        apiKey,
        req,
        prompt: buildToolLoopPrompt({
          goal,
          plan,
          searchContextText,
          attachmentContext: buildAttachmentContext(preparedAttachments),
          preparedAttachments,
          sandboxSession,
          toolResults,
        }),
        thinkingLevel,
      });

      if (action.action === "final_answer") {
        if (action.answer) {
          toolResults = [
            ...toolResults,
            {
              id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              title: "工具调度器已给出草稿答案",
              summary: clipText(action.answer, AGENT_TOOL_RESULT_MAX_CHARS),
            },
          ].slice(-AGENT_TOOL_RESULT_MAX_ITEMS);
        }
        break;
      }

      const executed = await executeToolCall({
        toolName: action.tool,
        input: action.input || {},
        userId,
        conversationId,
        sandboxSession,
        signal: req?.signal,
      });
      sandboxSession = executed.sandboxSession || sandboxSession;
      if (executed?.toolEvent) {
        toolResults = [...toolResults, executed.toolEvent].slice(-AGENT_TOOL_RESULT_MAX_ITEMS);
        emitAgentStep(sendEvent, {
          id: executed.toolEvent.id,
          kind: "tool",
          status: "done",
          title: executed.toolEvent.title,
          content: executed.toolEvent.summary,
        });
      }
    }

    emitAgentStep(sendEvent, {
      id: `agent_tool_${Date.now()}_done`,
      kind: "tool",
      status: "done",
      title: "同步沙盒操作已完成",
      content: toolResults.length > 0 ? `共执行 ${toolResults.length} 次同步操作` : "这次任务不需要额外沙盒操作",
    });
  }

  emitAgentStep(sendEvent, {
    id: `agent_finalize_${Date.now()}`,
    kind: "writer",
    status: "running",
    title: "正在整理最终结果",
    content: "准备生成最终答复",
  });

  const finalAnswer = await streamSeedAnswer({
    apiKey,
    req,
    model,
    historyMessages,
    prompt: goal,
    images,
    preparedAttachments,
    userId,
    instructions: await injectCurrentTimeSystemReminder(
      buildFinalPrompt({
        goal,
        plan,
        memoryContext,
        attachmentContext: buildAttachmentContext(preparedAttachments),
        searchContextText,
        toolResultsContext: buildToolResultsContext(toolResults),
      })
    ),
    thinkingLevel,
    sendEvent,
  });

  if (citations.length > 0) {
    sendEvent({ type: "citations", citations });
  }

  emitAgentStep(sendEvent, {
    id: `agent_finalize_${Date.now()}_done`,
    kind: "writer",
    status: "done",
    title: "最终结果已生成",
    content: clipText(finalAnswer, 600),
  });

  await appendMemoryEntry({
    userId,
    conversationId,
    summary: `${goal}\n\n${clipText(finalAnswer, 1000)}`,
  });

  return {
    finalAnswer,
    citations,
  };
}
