import AgentRun from "@/models/AgentRun";
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
import { AGENT_MODEL_ID, resolveSeedRuntimeModelId, SEED_MODEL_ID } from "@/lib/shared/models";
import { buildSeedJsonRequestBody, requestSeedJson } from "@/lib/server/seed/service";
import {
  createOrConnectSandbox,
  downloadSandboxArtifactToBlob,
  inspectPendingCommand,
  readSandboxFile,
  runSandboxCommand,
  writeSandboxFile,
} from "@/lib/server/sandbox/vercelSandbox";
import {
  AGENT_EXECUTION_STATES,
  AGENT_STEP_SEQUENCE,
  acquireRunLease,
  buildAgentMessageMeta,
  buildStepResult,
  generateResumeToken,
  releaseRunLease,
  renewRunLease,
  saveTextArtifact,
} from "@/lib/server/agent/runHelpers";

const AGENT_PLAN_MAX_TOKENS = 1200;
const AGENT_FINAL_MAX_TOKENS = 32000;
const AGENT_MEMORY_MAX_ITEMS = 5;
const AGENT_ATTACHMENT_MAX_CHARS = 12000;
const AGENT_ATTACHMENT_TOTAL_MAX_CHARS = 36000;
const AGENT_HISTORY_SUMMARY_LIMIT = 8;
const AGENT_SOFT_DEADLINE_MS = 38 * 1000;
const AGENT_ATTACHMENT_CONCURRENCY = 2;
const AGENT_ATTACHMENT_VISUAL_LIMIT = 6;
const AGENT_TOOL_LOOP_MAX_ROUNDS = 8;
const AGENT_TOOL_RESULT_MAX_ITEMS = 12;
const AGENT_TOOL_RESULT_MAX_CHARS = 2400;

function clipText(text, maxLength) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function isLikelySearchRequired(prompt) {
  if (typeof prompt !== "string") return false;
  const text = prompt.trim();
  if (!text) return false;

  return /最新|最近|当前|现在|今天|实时|官网|官方文档|官方说明|文档|教程|资料|来源|新闻|公告|价格|股价|汇率|天气|航班|比分|开奖|发布时间|发布日期|什么时候发布|何时发布|更新|版本|进展|状态|兼容|支持吗|支持不支持|能不能用|收费|定价|套餐|api|sdk|查一下|搜一下|搜索|检索|联网|上网/u.test(text);
}

function createPlannerFallback({ prompt, attachmentCount, enableWebSearch }) {
  const shouldCompute = /统计|汇总|求和|平均|筛选|排序|json|csv|表格|excel|xlsx|转换/u.test(prompt || "");
  const shouldSearch = enableWebSearch === true && isLikelySearchRequired(prompt);
  const shouldUseMemory = /继续|接着|上次|之前|刚才/u.test(prompt || "");
  const needsApproval = attachmentCount >= 3 || (shouldSearch && attachmentCount > 0);
  return {
    planTitle: "处理当前办公任务",
    shouldReadAttachments: attachmentCount > 0,
    shouldSearch,
    shouldUseMemory,
    shouldCompute,
    needsApproval,
    approvalReason: needsApproval ? "本次任务会同时读取较多资料或联网检索，继续前请确认。" : "",
    outputStyle: "简洁清晰，结论优先，必要时列出依据。",
    steps: [
      "理解任务目标",
      attachmentCount > 0 ? "读取附件资料" : null,
      shouldSearch ? "联网补充信息" : null,
      shouldCompute ? "整理结构化结果" : null,
      "输出最终结果",
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
    shouldCompute: base.shouldCompute === true || fallback.shouldCompute === true,
    needsApproval: base.needsApproval === true || fallback.needsApproval === true,
    approvalReason: typeof base.approvalReason === "string" && base.approvalReason.trim() ? base.approvalReason.trim() : fallback.approvalReason,
    outputStyle: typeof base.outputStyle === "string" && base.outputStyle.trim() ? base.outputStyle.trim() : fallback.outputStyle,
    steps: steps.length > 0 ? steps : fallback.steps,
  };
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

function buildPlannerPrompt({ prompt, historyMessages, attachmentCount, enableWebSearch }) {
  return [
    "请把当前任务判断成一个办公 Agent 执行计划，严格只返回 JSON。",
    "JSON 字段必须包含：planTitle、shouldReadAttachments、shouldSearch、shouldUseMemory、shouldCompute、needsApproval、approvalReason、outputStyle、steps。",
    "其中 steps 必须是 2 到 6 个简短中文步骤数组。",
    "默认按平衡策略判断，不要太保守。",
    "只要模型自身知识很可能没有答案、知识可能已经过时、问题本身带有明显时效性，或者不联网就很可能答旧、答偏、答不全，就开启 shouldSearch。",
    "如果只是稳定常识、改写翻译、基于现有上下文继续分析，才不要开启 shouldSearch。",
    "如果用户要求对资料、文档、表格、代码文件进行分析，再开启 shouldReadAttachments。",
    "如果用户是在延续前文，再开启 shouldUseMemory。",
    "如果任务涉及统计、整理、对比、提取结构化结果，再开启 shouldCompute。",
    "只有在一次会读取较多附件或附件与联网同时进行时，再把 needsApproval 设为 true。",
    `当前消息：${prompt || "(空)"}`,
    `最近对话：\n${summarizeHistoryMessages(historyMessages)}`,
    `当前附件数量：${attachmentCount}`,
    `当前是否允许联网：${enableWebSearch === true ? "是" : "否"}`,
  ].join("\n\n");
}

async function buildPlannerDecision({ apiKey, req, prompt, historyMessages, attachmentCount, enableWebSearch }) {
  const fallback = createPlannerFallback({ prompt, attachmentCount, enableWebSearch });
  try {
    const requestBody = buildSeedJsonRequestBody({
      model: SEED_MODEL_ID,
      input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: buildPlannerPrompt({ prompt, historyMessages, attachmentCount, enableWebSearch }) }] })],
      instructions: await injectCurrentTimeSystemReminder("你是一个办公 Agent 的任务规划器。请严格输出 JSON，不要输出 Markdown，不要输出解释。"),
      maxTokens: AGENT_PLAN_MAX_TOKENS,
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

function tryParseJson(text) {
  if (!isNonEmptyString(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return parseJsonFromText(text);
  }
}

function runStructuredCompute({ prompt, preparedAttachments }) {
  const summaries = [];
  for (const item of preparedAttachments) {
    const file = item?.file || {};
    const extractedText = typeof item?.extractedText === "string" ? item.extractedText : "";
    if (file.category === "spreadsheet") {
      summaries.push(`${file.name}：表格共 ${Number(item?.sheetCount) || 1} 个工作表，约 ${Number(item?.rowCount) || 0} 行内容。`);
      continue;
    }
    if (file.extension === "json") {
      const parsed = tryParseJson(extractedText);
      if (Array.isArray(parsed)) summaries.push(`${file.name}：JSON 数组，共 ${parsed.length} 条记录。`);
      else if (parsed && typeof parsed === "object") summaries.push(`${file.name}：JSON 对象，共 ${Object.keys(parsed).length} 个顶级字段。`);
      continue;
    }
    if (file.category === "data" || file.category === "code" || file.category === "text") {
      summaries.push(`${file.name}：约 ${extractedText ? extractedText.split("\n").length : 0} 行文本内容。`);
    }
  }
  if (summaries.length === 0 && isNonEmptyString(prompt) && /统计|汇总|求和|平均|筛选|排序/u.test(prompt)) {
    summaries.push("当前没有可直接做结构化统计的表格或 JSON 数据，后续回答将只基于文本理解。");
  }
  return summaries.join("\n");
}

function buildAttachmentContext(preparedAttachments) {
  const sections = [];
  let totalChars = 0;
  for (const item of preparedAttachments) {
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

function buildMemoryContext(memorySummaries) {
  if (!Array.isArray(memorySummaries) || memorySummaries.length === 0) return "";
  return memorySummaries.map((item, index) => `记忆 ${index + 1}：${item}`).join("\n");
}

function buildPlannerSummary(plan) {
  if (!plan) return "";
  const steps = Array.isArray(plan.steps) ? plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "";
  return [plan.planTitle, steps].filter(Boolean).join("\n");
}

function buildFinalPrompt({ goal, plan, memoryContext, attachmentContext, searchContextText, computeContext }) {
  return [
    "你是 Vectaix 的 Agent，请基于已有资料直接给出可交付结果。",
    "如果用户问你是谁、你是什么、你来自哪里，必须明确回答你是 Vectaix 的 Agent。",
    "不要自称其他品牌、平台，也不要模糊地只说自己是普通 Agent。",
    "要求：用简体中文，大白话，结论优先；如果用了联网信息，要尽量给出来源感知；如果资料不足，要明确说不确定。",
    `用户任务：${goal}`,
    plan ? `执行计划：\n${buildPlannerSummary(plan)}` : "",
    memoryContext ? `会话记忆：\n${memoryContext}` : "",
    attachmentContext ? `附件资料：\n${attachmentContext}` : "",
    searchContextText ? `联网资料：\n${searchContextText}` : "",
    computeContext ? `结构化整理结果：\n${computeContext}` : "",
  ].filter(Boolean).join("\n\n");
}

function chunkText(text, maxLength = 120) {
  if (!isNonEmptyString(text)) return [];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLength) {
    let index = rest.lastIndexOf("\n", maxLength);
    if (index < 24) index = rest.lastIndexOf("。", maxLength);
    if (index < 24) index = maxLength;
    chunks.push(rest.slice(0, index));
    rest = rest.slice(index);
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

async function appendMemoryEntry({ userId, conversationId, runId, summary }) {
  const finalSummary = clipText(summary, 1500);
  if (!finalSummary) return;
  await MemoryEntry.create({
    userId,
    scope: "agent",
    summary: finalSummary,
    sourceRef: {
      conversationId: conversationId?.toString?.() || String(conversationId || ""),
      runId: runId?.toString?.() || String(runId || ""),
    },
    updatedAt: new Date(),
  });
}

async function getConversationSandboxSession({ userId, conversationId, excludeRunId = null }) {
  const query = {
    userId,
    conversationId,
    status: { $in: ["running", "waiting_continue", "awaiting_approval"] },
    "sandboxSession.sandboxId": { $exists: true, $ne: "" },
  };
  if (excludeRunId) query._id = { $ne: excludeRunId };

  const latestRun = await AgentRun.findOne(query)
    .sort({ updatedAt: -1 })
    .select("sandboxSession")
    .lean();

  return latestRun?.sandboxSession && typeof latestRun.sandboxSession === "object"
    ? latestRun.sandboxSession
    : null;
}

async function runSeedDecision({ apiKey, req, prompt, historyMessages, searchRounds }) {
  const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages, searchRounds });
  const requestBody = buildSeedJsonRequestBody({
    model: SEED_MODEL_ID,
    input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: userText }] })],
    instructions: systemText,
    maxTokens: WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
    temperature: 0.1,
  });
  const result = await requestSeedJson({ apiKey, requestBody, req });
  return result.text;
}

function createToolEvent(title, summary, extra = {}) {
  return {
    id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    summary: clipText(summary, AGENT_TOOL_RESULT_MAX_CHARS),
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

async function executeToolCall({
  toolName,
  input,
  userId,
  conversationId,
  runId,
  sandboxSession,
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
    const background = input?.background === true;
    const cwd = typeof input?.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : session.workdir;
    const executed = await runSandboxCommand({ sandbox, session, command, cwd, background });
    return {
      sandboxSession: {
        ...session,
        requiresApproval: false,
        latestCommand: executed.result,
        pendingCommand: executed.pendingCommand,
        canResume: Boolean(executed.pendingCommand),
      },
      toolEvent: createToolEvent(
        background ? "已启动后台命令" : "已执行沙盒命令",
        background
          ? `${command}\n后台命令 ID：${executed.pendingCommand?.cmdId || "未知"}`
          : `${command}\n退出码：${executed.result?.exitCode ?? "未知"}\n${executed.result?.stdout || executed.result?.stderr || ""}`,
        {
          tool: toolName,
          background,
          cmdId: executed.pendingCommand?.cmdId || executed.result?.cmdId || null,
        }
      ),
      shouldPauseForContinue: Boolean(executed.pendingCommand),
    };
  }

  if (toolName === "sandbox_upload") {
    const url = typeof input?.url === "string" ? input.url.trim() : "";
    if (!url) throw new Error("sandbox_upload 缺少 url");
    const blobFile = await loadBlobFileByUser({ userId, url });
    if (!blobFile) throw new Error("文件不存在或无权限访问");
    const response = await fetch(blobFile.url, { cache: "no-store" });
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
      sandboxSession: { ...session, requiresApproval: false },
      toolEvent: createToolEvent("已上传文件到沙盒", `${blobFile.originalName || "文件"} -> ${remotePath}`, {
        tool: toolName,
        remotePath,
      }),
    };
  }

  if (toolName === "sandbox_read_file") {
    const remotePath = typeof input?.path === "string" ? input.path.trim() : "";
    if (!remotePath) throw new Error("sandbox_read_file 缺少 path");
    const content = await readSandboxFile({ sandbox, remotePath });
    return {
      sandboxSession: { ...session, requiresApproval: false },
      toolEvent: createToolEvent("已读取沙盒文件", `${remotePath}\n${content.text || ""}`, {
        tool: toolName,
        path: remotePath,
      }),
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
      runId,
      title: typeof input?.title === "string" ? input.title.trim() : "artifact",
      mimeType: typeof input?.mimeType === "string" ? input.mimeType.trim() : "text/plain",
      extension: typeof input?.extension === "string" ? input.extension.trim() : "txt",
    });
    return {
      sandboxSession: { ...session, requiresApproval: false },
      artifact,
      toolEvent: createToolEvent("已导出沙盒产物", `${remotePath}\n已保存为：${artifact.url}`, {
        tool: toolName,
        path: remotePath,
        artifact,
      }),
    };
  }

  if (toolName === "parse_attachment") {
    const url = typeof input?.url === "string" ? input.url.trim() : "";
    if (!url) throw new Error("parse_attachment 缺少 url");
    const prepared = await prepareDocumentAttachment({
      userId,
      url,
      conversationId,
      runId,
      sandboxSession: session,
    });
    return {
      sandboxSession: prepared.sandboxSession
        ? { ...prepared.sandboxSession, requiresApproval: false }
        : { ...session, requiresApproval: false },
      attachmentRecord: {
        url,
        name: prepared.prepared?.file?.name || "附件",
        sandboxPath: prepared.prepared?.sandboxPath || "",
        formatSummary: prepared.prepared?.formatSummary || "",
      },
      toolEvent: createToolEvent(
        "已在沙盒中解析附件",
        `${prepared.prepared?.file?.name || "附件"}\n${prepared.prepared?.formatSummary || ""}`,
        {
          tool: toolName,
          url,
        }
      ),
    };
  }

  throw new Error(`不支持的工具：${toolName}`);
}

async function buildFinalSeedAnswer({ apiKey, req, model, instructions, historyMessages, prompt, images }) {
  const input = await buildBytedanceInputFromHistory(historyMessages || []);
  const userContent = [];
  if (isNonEmptyString(prompt)) userContent.push({ type: "input_text", text: prompt });
  if (Array.isArray(images)) {
    for (const item of images) {
      if (!item?.url) continue;
      const { base64Data, mimeType } = await fetchImageAsBase64(item.url);
      userContent.push({ type: "input_image", image_url: `data:${mimeType};base64,${base64Data}` });
    }
  }
  if (userContent.length > 0) input.push(buildSeedMessageInput({ role: "user", content: userContent }));
  const requestBody = buildSeedJsonRequestBody({
    model: resolveSeedRuntimeModelId(model),
    input,
    instructions,
    maxTokens: AGENT_FINAL_MAX_TOKENS,
    temperature: 0.35,
  });
  const result = await requestSeedJson({ apiKey, requestBody, req });
  return result.text;
}

async function updateRunDocument(runId, patch) {
  return AgentRun.findByIdAndUpdate(runId, patch, { new: true });
}

async function createRunStep(run, step) {
  const nextSteps = Array.isArray(run.steps) ? run.steps.slice() : [];
  nextSteps.push(step);
  const updated = await updateRunDocument(run._id, {
    $set: {
      currentStep: step.title,
      steps: nextSteps,
      updatedAt: new Date(),
    },
  });
  return { run: updated, stepIndex: nextSteps.length - 1 };
}

async function patchRunStep(run, stepIndex, patch) {
  const nextSteps = Array.isArray(run.steps) ? run.steps.slice() : [];
  if (!nextSteps[stepIndex]) return run;
  nextSteps[stepIndex] = { ...nextSteps[stepIndex], ...patch };
  return updateRunDocument(run._id, {
    $set: {
      steps: nextSteps,
      currentStep: nextSteps[stepIndex]?.title || run.currentStep,
      updatedAt: new Date(),
    },
  });
}

async function saveStepResult(run, stepType, payload) {
  const nextResults = Array.isArray(run.stepResults) ? run.stepResults.slice() : [];
  const index = nextResults.findIndex((item) => item?.stepType === stepType);
  const nextValue = buildStepResult(stepType, payload);
  if (index >= 0) nextResults[index] = { ...nextResults[index], ...nextValue };
  else nextResults.push(nextValue);
  return updateRunDocument(run._id, {
    $set: {
      stepResults: nextResults,
      updatedAt: new Date(),
    },
  });
}

async function updateRunContext(run, patch) {
  const base = run?.contextSnapshot && typeof run.contextSnapshot === "object" ? run.contextSnapshot : {};
  return updateRunDocument(run._id, {
    $set: {
      contextSnapshot: { ...base, ...patch },
      updatedAt: new Date(),
    },
  });
}

function emitAgentStatus(sendEvent, payload) {
  sendEvent({ type: "agent_status", ...payload });
}

function emitAgentStep(sendEvent, step) {
  sendEvent({ type: "agent_step", step });
}

function emitAgentThought(sendEvent, text) {
  if (!isNonEmptyString(text)) return;
  sendEvent({ type: "thought", content: text });
}

function shouldYield(startedAt) {
  return Date.now() - startedAt >= AGENT_SOFT_DEADLINE_MS;
}

function collectAttachmentUrls(historyMessages, currentAttachments) {
  const urls = new Set();
  for (const item of Array.isArray(currentAttachments) ? currentAttachments : []) {
    if (typeof item?.url === "string" && item.url) urls.add(item.url);
  }
  for (const message of Array.isArray(historyMessages) ? historyMessages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (typeof part?.fileData?.url === "string" && part.fileData.url) urls.add(part.fileData.url);
    }
  }
  return Array.from(urls);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const results = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, () => worker()));
  return results;
}

function buildAttachmentCompareSummary(preparedAttachments) {
  if (!Array.isArray(preparedAttachments) || preparedAttachments.length < 2) return "";
  const names = preparedAttachments.map((item) => item?.file?.name).filter(Boolean).slice(0, 6);
  return names.length >= 2 ? `本轮已同时读取多个附件，可用于差异对比：${names.join("、")}。` : "";
}

function countAttachmentVisualAssets(preparedAttachments) {
  return (Array.isArray(preparedAttachments) ? preparedAttachments : []).reduce((sum, item) => {
    const count = Number(item?.visualAssetCount) || (Array.isArray(item?.visualAssets) ? item.visualAssets.length : 0);
    return sum + Math.max(0, count);
  }, 0);
}

function pickAttachmentVisualImages(preparedAttachments, currentImages = []) {
  const picked = [];
  const seen = new Set(
    (Array.isArray(currentImages) ? currentImages : [])
      .map((item) => (typeof item?.url === "string" ? item.url : ""))
      .filter(Boolean)
  );
  for (const item of Array.isArray(preparedAttachments) ? preparedAttachments : []) {
    for (const asset of Array.isArray(item?.visualAssets) ? item.visualAssets : []) {
      if (!asset?.url || !asset?.mimeType || seen.has(asset.url)) continue;
      picked.push({ url: asset.url, mimeType: asset.mimeType });
      seen.add(asset.url);
      if (picked.length >= AGENT_ATTACHMENT_VISUAL_LIMIT) return picked;
    }
  }
  return picked;
}

function buildStructuredJsonOutputs(preparedAttachments) {
  const outputs = [];
  for (const item of Array.isArray(preparedAttachments) ? preparedAttachments : []) {
    if (item?.file?.extension !== "json") continue;
    const parsed = tryParseJson(item?.extractedText || "");
    if (!parsed) continue;
    outputs.push({
      name: item.file?.name || "json",
      type: Array.isArray(parsed) ? "array" : "object",
      preview: clipText(JSON.stringify(parsed, null, 2), 1500),
    });
  }
  return outputs;
}

function createDefaultContextSnapshot(attachmentUrls = []) {
  return {
    memorySummaries: [],
    attachmentUrls,
    attachmentRecords: [],
    attachmentSummaries: [],
    attachmentContext: "",
    attachmentVisualSummary: "",
    attachmentCompareSummary: "",
    structuredJsonOutputs: [],
    searchDecisions: [],
    searchContextText: "",
    computeContext: "",
    toolResults: [],
    draftAnswer: "",
  };
}

function buildToolResultsContext(toolResults) {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return "";
  return toolResults
    .slice(-AGENT_TOOL_RESULT_MAX_ITEMS)
    .map((item, index) => {
      const title = typeof item?.title === "string" && item.title ? item.title : `工具结果 ${index + 1}`;
      const summary = typeof item?.summary === "string" && item.summary
        ? item.summary
        : clipText(JSON.stringify(item || {}), AGENT_TOOL_RESULT_MAX_CHARS);
      return `${title}\n${summary}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeToolActionResponse(parsed) {
  const base = parsed && typeof parsed === "object" ? parsed : {};
  return {
    action: typeof base.action === "string" ? base.action.trim() : "",
    tool: typeof base.tool === "string" ? base.tool.trim() : "",
    input: base.input && typeof base.input === "object" && !Array.isArray(base.input) ? base.input : {},
    answer: typeof base.answer === "string" ? base.answer.trim() : "",
    reason: typeof base.reason === "string" ? base.reason.trim() : "",
  };
}

function buildToolLoopPrompt({ goal, plan, sandboxSession, contextSnapshot, approvalGranted = false }) {
  const attachmentSummaries = Array.isArray(contextSnapshot?.attachmentSummaries)
    ? contextSnapshot.attachmentSummaries
      .map((item) => [
        item?.name ? `文件：${item.name}` : "",
        item?.sandboxPath ? `沙盒路径：${item.sandboxPath}` : "",
        item?.formatSummary ? `结构：${item.formatSummary}` : "",
      ].filter(Boolean).join("，"))
      .filter(Boolean)
      .join("\n")
    : "";

  return [
    "你是 Vectaix Agent 的工具决策器，必须严格只返回 JSON。",
    "只允许 3 种 action：tool_call、approval_request、final_answer。",
    "可用工具：sandbox_exec、sandbox_upload、sandbox_read_file、sandbox_download_artifact、parse_attachment。",
    "JSON 示例：{\"action\":\"tool_call\",\"tool\":\"sandbox_exec\",\"input\":{\"command\":\"python main.py\",\"background\":false}}",
    "如果返回 approval_request，必须同时提供 tool 和 input，表示审批通过后要执行的动作。",
    "如果需要执行 shell、后台任务、写入沙盒或可能联网，请先返回 approval_request。",
    approvalGranted ? "当前操作已经获得用户批准；如果需要工具，请直接返回 tool_call，不要再次请求审批。" : "",
    `用户目标：${goal}`,
    plan ? `执行计划：\n${buildPlannerSummary(plan)}` : "",
    sandboxSession?.workdir ? `当前沙盒目录：${sandboxSession.workdir}` : "",
    attachmentSummaries ? `已知附件：\n${attachmentSummaries}` : "",
    contextSnapshot?.attachmentContext ? `附件内容：\n${clipText(contextSnapshot.attachmentContext, 4000)}` : "",
    contextSnapshot?.searchContextText ? `联网资料：\n${clipText(contextSnapshot.searchContextText, 2500)}` : "",
    buildToolResultsContext(contextSnapshot?.toolResults) ? `最近工具结果：\n${buildToolResultsContext(contextSnapshot.toolResults)}` : "",
  ].filter(Boolean).join("\n\n");
}

async function requestToolAction({ apiKey, req, prompt }) {
  const requestBody = buildSeedJsonRequestBody({
    model: SEED_MODEL_ID,
    input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: prompt }] })],
    instructions: await injectCurrentTimeSystemReminder("你是 Vectaix Agent 的 JSON 工具调度器，只能输出 JSON。"),
    maxTokens: 1800,
    temperature: 0.2,
  });
  const result = await requestSeedJson({ apiKey, requestBody, req });
  return normalizeToolActionResponse(tryParseJson(result.text));
}

function toolCallNeedsApproval(toolName) {
  return toolName === "sandbox_exec" || toolName === "sandbox_upload";
}

function shouldPrepareSandboxStep({ plan, attachmentUrls }) {
  return plan?.shouldReadAttachments === true && Array.isArray(attachmentUrls) && attachmentUrls.length > 0;
}

export async function runAgentRuntimeV2({
  apiKey,
  req,
  userId,
  conversationId,
  model,
  prompt,
  historyMessages,
  config,
  attachments,
  images,
  runId,
  resume = false,
  approvalDecision,
  sendEvent,
}) {
  const runtimeModel = model === AGENT_MODEL_ID ? AGENT_MODEL_ID : model;
  const conversationObjectId = conversationId;
  let currentAttachments = Array.isArray(attachments) ? attachments : [];
  let currentImages = Array.isArray(images) ? images : [];
  const runtimePrompt = typeof prompt === "string" && prompt.trim() ? prompt.trim() : "";
  const enableWebSearch = config?.webSearch === true;
  const startedAt = Date.now();
  const leaseOwner = `agent:${userId}:${conversationObjectId}`;

  let run = null;
  if (resume && isNonEmptyString(runId)) {
    run = await AgentRun.findOne({
      _id: runId,
      userId,
      conversationId: conversationObjectId,
    });
    if (!run) throw new Error("未找到可继续的 Agent 任务");
  } else {
    const attachmentUrls = collectAttachmentUrls(historyMessages, currentAttachments);
    const inheritedSandboxSession = await getConversationSandboxSession({
      userId,
      conversationId: conversationObjectId,
    });
    run = await AgentRun.create({
      userId,
      conversationId: conversationObjectId,
      model: runtimeModel,
      goal: runtimePrompt || "继续执行 Agent 任务",
      runVersion: 3,
      status: "running",
      executionState: AGENT_EXECUTION_STATES.planning,
      currentStep: "开始处理",
      currentCursor: 0,
      resumeToken: generateResumeToken(),
      metadata: {
        attachments: currentAttachments,
        images: currentImages,
        imageCount: currentImages.length,
        webSearch: enableWebSearch,
      },
      contextSnapshot: createDefaultContextSnapshot(attachmentUrls),
      sandboxSession: inheritedSandboxSession || null,
    });
  }

  if ((!currentAttachments || currentAttachments.length === 0) && Array.isArray(run?.metadata?.attachments)) {
    currentAttachments = run.metadata.attachments;
  }
  if ((!currentImages || currentImages.length === 0) && Array.isArray(run?.metadata?.images)) {
    currentImages = run.metadata.images;
  }
  const goal = runtimePrompt || run.goal || "继续执行 Agent 任务";
  const attachmentUrls = collectAttachmentUrls(historyMessages, currentAttachments);

  const { run: leasedRun, leaseToken } = await acquireRunLease(run._id, leaseOwner);
  run = leasedRun;

  const heartbeat = async () => {
    const next = await renewRunLease(run._id, leaseOwner, leaseToken);
    if (next) run = next;
  };

  const persistSandboxSession = async (sandboxSession) => {
    run = await updateRunDocument(run._id, {
      $set: {
        sandboxSession,
        updatedAt: new Date(),
      },
    });
  };

  const enterWaitingContinue = async (reason = "当前轮次已接近时限，准备继续下一轮执行。") => {
    await heartbeat();
    run = await updateRunDocument(run._id, {
      $set: {
        status: "waiting_continue",
        executionState: AGENT_EXECUTION_STATES.waitingContinue,
        currentStep: "等待继续执行",
        sandboxSession: run?.sandboxSession
          ? { ...run.sandboxSession, canResume: true }
          : run?.sandboxSession,
        updatedAt: new Date(),
      },
    });
    sendEvent({
      type: "agent_checkpoint",
      runId: run._id.toString(),
      reason,
      cursor: run.currentCursor,
    });
    emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
      status: "waiting_continue",
      executionState: AGENT_EXECUTION_STATES.waitingContinue,
      canResume: true,
    }));
    return {
      run,
      finalAnswer: typeof run?.contextSnapshot?.draftAnswer === "string" ? run.contextSnapshot.draftAnswer : "",
      citations: Array.isArray(run?.citations) ? run.citations : [],
      status: "waiting_continue",
    };
  };

  const startStep = async ({ type, title, toolName = null, inputSummary = "" }) => {
    const existingIndex = Array.isArray(run.steps) ? run.steps.findIndex((item) => item?.type === type) : -1;
    if (existingIndex >= 0) {
      run = await patchRunStep(run, existingIndex, {
        title,
        toolName,
        inputSummary,
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
      });
      emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
        status: "running",
        executionState: AGENT_EXECUTION_STATES.running,
        canResume: false,
      }));
      return existingIndex;
    }
    const step = {
      stepOrder: (run.steps?.length || 0) + 1,
      type,
      title,
      status: "running",
      toolName,
      inputSummary,
      outputSummary: "",
      startedAt: new Date(),
      finishedAt: null,
    };
    const stepIndexInfo = await createRunStep(run, step);
    run = stepIndexInfo.run;
    emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
      status: "running",
      executionState: AGENT_EXECUTION_STATES.running,
      canResume: false,
    }));
    return stepIndexInfo.stepIndex;
  };

  const finishStep = async (stepIndex, type, { outputSummary = "", result = null, contextPatch = null } = {}) => {
    run = await patchRunStep(run, stepIndex, {
      status: "done",
      outputSummary,
      finishedAt: new Date(),
    });
    if (result) run = await saveStepResult(run, type, result);
    if (contextPatch) run = await updateRunContext(run, contextPatch);
    run = await updateRunDocument(run._id, {
      $set: {
        currentCursor: Math.max(Number(run.currentCursor) || 0, AGENT_STEP_SEQUENCE.indexOf(type) + 1),
        executionState: AGENT_EXECUTION_STATES.running,
        status: "running",
        updatedAt: new Date(),
      },
    });
    emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
      status: "running",
      executionState: AGENT_EXECUTION_STATES.running,
      canResume: false,
    }));
    await heartbeat();
  };

  const skipStep = async (type, title) => {
    const stepIndex = await startStep({ type, title, inputSummary: "" });
    await finishStep(stepIndex, type, { outputSummary: "已跳过", result: { skipped: true } });
  };

  try {
    if (run.status === "cancelled") {
      return { run, finalAnswer: "", citations: [], status: "cancelled" };
    }

    if (
      run.executionState === AGENT_EXECUTION_STATES.awaitingApproval &&
      (approvalDecision === "approved" || approvalDecision === true)
    ) {
      run = await updateRunDocument(run._id, {
        $set: {
          status: "running",
          executionState: AGENT_EXECUTION_STATES.running,
          "approvalRequest.status": "approved",
          "approvalRequest.decidedAt": new Date(),
          updatedAt: new Date(),
        },
      });
    }

    emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
      status: run.status || "running",
      executionState: run.executionState || AGENT_EXECUTION_STATES.running,
      canResume: run.status === "waiting_continue",
    }));

    while ((Number(run.currentCursor) || 0) < AGENT_STEP_SEQUENCE.length) {
      if (shouldYield(startedAt)) return enterWaitingContinue();

      const stepType = AGENT_STEP_SEQUENCE[run.currentCursor];
      const plan = run.planSnapshot && typeof run.planSnapshot === "object" ? run.planSnapshot : null;
      const contextSnapshot = run.contextSnapshot && typeof run.contextSnapshot === "object"
        ? run.contextSnapshot
        : createDefaultContextSnapshot(attachmentUrls);

      if (stepType === "plan") {
        const stepIndex = await startStep({
          type: "plan",
          title: "正在规划任务",
          inputSummary: clipText(goal, 300),
        });
        emitAgentThought(sendEvent, "正在规划这个任务的处理方式...\n");
        const nextPlan = await buildPlannerDecision({
          apiKey,
          req,
          prompt: goal,
          historyMessages,
          attachmentCount: countPlannableAttachments(historyMessages, currentAttachments),
          enableWebSearch,
        });
        run = await updateRunDocument(run._id, { $set: { planSnapshot: nextPlan, updatedAt: new Date() } });
        await finishStep(stepIndex, "plan", {
          outputSummary: buildPlannerSummary(nextPlan),
          result: { planTitle: nextPlan.planTitle, summary: buildPlannerSummary(nextPlan) },
        });
        emitAgentThought(sendEvent, `已确定执行方向：${nextPlan.planTitle}。\n`);

        if (nextPlan.needsApproval === true && run?.approvalRequest?.status !== "approved") {
          run = await updateRunDocument(run._id, {
            $set: {
              status: "awaiting_approval",
              executionState: AGENT_EXECUTION_STATES.awaitingApproval,
              currentStep: "等待用户确认",
              approvalRequest: {
                reason: nextPlan.approvalReason || "本次任务需要继续读取资料或联网，请确认后再继续。",
                payload: {
                  attachments: currentAttachments.length,
                  webSearch: nextPlan.shouldSearch === true,
                  planTitle: nextPlan.planTitle,
                },
                status: "pending",
                decidedAt: null,
              },
              updatedAt: new Date(),
            },
          });
          emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
            status: "awaiting_approval",
            executionState: AGENT_EXECUTION_STATES.awaitingApproval,
            canResume: false,
          }));
          return { run, finalAnswer: "", citations: [], status: "awaiting_approval" };
        }
        continue;
      }

      if (stepType === "memory") {
        if (!plan?.shouldUseMemory) {
          await skipStep("memory", "跳过会话记忆");
          continue;
        }
        const stepIndex = await startStep({
          type: "memory",
          title: "正在读取会话记忆",
          toolName: "memory_lookup",
          inputSummary: "读取最近的 Agent 任务摘要",
        });
        emitAgentThought(sendEvent, "正在结合当前会话上下文...\n");
        const memorySummaries = await loadMemorySummaries(userId);
        await finishStep(stepIndex, "memory", {
          outputSummary: memorySummaries.length > 0 ? `已读取 ${memorySummaries.length} 条记忆` : "没有可用的近期记忆",
          result: { count: memorySummaries.length },
          contextPatch: { memorySummaries },
        });
        continue;
      }

      if (stepType === "sandbox_prepare") {
        if (!shouldPrepareSandboxStep({ plan, attachmentUrls })) {
          await skipStep("sandbox_prepare", "跳过沙盒准备");
          continue;
        }
        const stepIndex = await startStep({
          type: "sandbox_prepare",
          title: "正在准备运行环境",
          toolName: "sandbox_connect",
          inputSummary: "准备当前会话运行环境",
        });
        emitAgentStep(sendEvent, {
          id: `agent_sandbox_prepare_${Date.now()}`,
          kind: "sandbox",
          status: "running",
          title: "正在准备运行环境",
          message: "正在准备运行环境",
        });
        const created = await createOrConnectSandbox({
          userId,
          conversationId: conversationObjectId,
          existingSession: run?.sandboxSession,
          allowInternetAccess: true,
        });
        await persistSandboxSession(created.session);
        await finishStep(stepIndex, "sandbox_prepare", {
          outputSummary: "运行环境已准备完成",
          result: { sandboxId: created.session.sandboxId, workdir: created.session.workdir },
        });
        emitAgentStep(sendEvent, {
          id: `agent_sandbox_prepare_${Date.now()}_done`,
          kind: "sandbox",
          status: "done",
          title: "运行环境已准备完成",
          content: "运行环境已准备完成",
        });
        continue;
      }

      if (stepType === "attachment_prepare") {
        if (!plan?.shouldReadAttachments || attachmentUrls.length === 0) {
          await skipStep("attachment_prepare", "跳过附件准备");
          continue;
        }
        const stepIndex = await startStep({
          type: "attachment_prepare",
          title: "正在整理附件清单",
          toolName: "attachment_prepare",
          inputSummary: `共发现 ${attachmentUrls.length} 个附件引用`,
        });
        await finishStep(stepIndex, "attachment_prepare", {
          outputSummary: `已整理 ${attachmentUrls.length} 个附件引用`,
          result: { count: attachmentUrls.length, attachmentUrls },
          contextPatch: { attachmentUrls },
        });
        continue;
      }

      if (stepType === "attachment_read") {
        if (!plan?.shouldReadAttachments || attachmentUrls.length === 0) {
          await skipStep("attachment_read", "跳过附件读取");
          continue;
        }
        const stepIndex = await startStep({
          type: "attachment_read",
          title: "正在读取附件资料",
          toolName: "read_attachments",
          inputSummary: `准备读取 ${attachmentUrls.length} 个附件`,
        });
        emitAgentStep(sendEvent, {
          id: `agent_attachment_read_${Date.now()}`,
          kind: "reader",
          status: "running",
          title: "正在读取附件资料",
          message: `准备读取 ${attachmentUrls.length} 个附件`,
        });
        const preparedAttachments = [];
        let sandboxSession = run?.sandboxSession || null;
        for (const url of attachmentUrls) {
          const prepared = await prepareDocumentAttachment({
            userId,
            url,
            conversationId: conversationObjectId,
            runId: run._id.toString(),
            sandboxSession,
          });
          sandboxSession = prepared.sandboxSession || sandboxSession;
          if (sandboxSession) {
            await persistSandboxSession(sandboxSession);
          }
          if (prepared?.prepared) {
            preparedAttachments.push(prepared.prepared);
          }
        }
        const visualImageInputs = pickAttachmentVisualImages(preparedAttachments, currentImages);
        if (visualImageInputs.length > 0) {
          currentImages = [...currentImages, ...visualImageInputs];
          run = await updateRunDocument(run._id, {
            $set: {
              "metadata.images": currentImages,
              "metadata.imageCount": currentImages.length,
              updatedAt: new Date(),
            },
          });
        }
        const totalVisualAssets = countAttachmentVisualAssets(preparedAttachments);
        const attachmentSummaries = preparedAttachments.map((item) => ({
          name: item.file?.name || "附件",
          extension: item.file?.extension || "",
          category: item.file?.category || "",
          sandboxPath: item?.sandboxPath || "",
          formatSummary: item.file?.formatSummary || item.formatSummary || "",
          visualAssetCount: Number(item?.visualAssetCount) || (Array.isArray(item?.visualAssets) ? item.visualAssets.length : 0),
          pageCount: Number(item?.pageCount) || 0,
          sheetCount: Number(item?.sheetCount) || 0,
          rowCount: Number(item?.rowCount) || 0,
        }));
        await finishStep(stepIndex, "attachment_read", {
          outputSummary: preparedAttachments.length > 0 ? `已读取 ${preparedAttachments.length} 个附件` : "没有读取到可用附件内容",
          result: { count: preparedAttachments.length, names: attachmentSummaries.map((item) => item.name) },
          contextPatch: {
            attachmentRecords: preparedAttachments.map((item) => ({
              url: item.file?.url || "",
              name: item.file?.name || "附件",
              sandboxPath: item?.sandboxPath || "",
              formatSummary: item.file?.formatSummary || item.formatSummary || "",
            })),
            attachmentSummaries,
            attachmentContext: buildAttachmentContext(preparedAttachments),
            attachmentVisualSummary: totalVisualAssets > 0 ? `本轮附件共提取 ${totalVisualAssets} 个视觉内容，并已作为图片资料提供给模型。` : "",
            attachmentCompareSummary: buildAttachmentCompareSummary(preparedAttachments),
            structuredJsonOutputs: buildStructuredJsonOutputs(preparedAttachments),
          },
        });
        emitAgentStep(sendEvent, {
          id: `agent_attachment_read_${Date.now()}_done`,
          kind: "reader",
          status: "done",
          title: "附件资料已读取",
          content: preparedAttachments.length > 0
            ? attachmentSummaries.map((item) => `${item.name}：已提取文本${item.sandboxPath ? `，沙盒路径 ${item.sandboxPath}` : ""}${item.visualAssetCount > 0 ? `，并发现 ${item.visualAssetCount} 个视觉内容` : ""}`).join("\n")
            : "没有读取到可用附件内容",
        });
        continue;
      }

      if (stepType === "search_decide") {
        if (!plan?.shouldSearch || enableWebSearch !== true) {
          await skipStep("search_decide", "跳过联网决策");
          continue;
        }
        const stepIndex = await startStep({
          type: "search_decide",
          title: "正在确认联网策略",
          toolName: "search_decide",
          inputSummary: clipText(goal, 180),
        });
        const decisionText = await runSeedDecision({ apiKey, req, prompt: goal, historyMessages, searchRounds: 0 });
        const searchDecisions = Array.isArray(contextSnapshot.searchDecisions)
          ? [...contextSnapshot.searchDecisions, clipText(decisionText, 1200)]
          : [clipText(decisionText, 1200)];
        await finishStep(stepIndex, "search_decide", {
          outputSummary: "已生成联网决策",
          result: { preview: clipText(decisionText, 300) },
          contextPatch: { searchDecisions },
        });
        continue;
      }

      if (stepType === "search_run") {
        if (!plan?.shouldSearch || enableWebSearch !== true) {
          await skipStep("search_run", "跳过联网搜索");
          continue;
        }
        const stepIndex = await startStep({
          type: "search_run",
          title: "正在联网搜索",
          toolName: "web_search",
          inputSummary: clipText(goal, 180),
        });
        emitAgentThought(sendEvent, "正在联网补充相关信息...\n");
        const citationList = [];
        const searchResult = await runWebSearchOrchestration({
          enableWebSearch: true,
          prompt: goal,
          historyMessages,
          decisionRunner: ({ prompt: decisionPrompt, historyMessages: decisionHistory, searchRounds }) =>
            runSeedDecision({ apiKey, req, prompt: decisionPrompt, historyMessages: decisionHistory, searchRounds }),
          sendEvent,
          pushCitations: (items) => {
            for (const item of Array.isArray(items) ? items : []) {
              if (!item?.url) continue;
              if (!citationList.some((citation) => citation.url === item.url)) citationList.push(item);
            }
          },
          sendSearchError: (message, details = {}) => sendEvent({ type: "search_error", message, ...details }),
          model: resolveSeedRuntimeModelId(model),
          conversationId: conversationObjectId?.toString?.() || "",
          providerLabel: "Agent",
          ...getWebSearchProviderRuntimeOptions("seed"),
        });
        run = await updateRunDocument(run._id, { $set: { citations: citationList, updatedAt: new Date() } });
        await finishStep(stepIndex, "search_run", {
          outputSummary: searchResult?.searchContextText ? "已完成联网资料收集" : "联网没有拿到有效补充资料",
          result: { citationCount: citationList.length },
          contextPatch: { searchContextText: searchResult?.searchContextText || "" },
        });
        continue;
      }

      if (stepType === "tool_loop") {
        const stepIndex = await startStep({
          type: "tool_loop",
          title: "正在执行沙盒工具循环",
          toolName: "tool_loop",
          inputSummary: "根据任务目标决定是否调用沙盒工具",
        });
        emitAgentThought(sendEvent, "正在根据资料和沙盒状态决定下一步动作...\n");
        let toolResults = Array.isArray(contextSnapshot.toolResults) ? contextSnapshot.toolResults.slice(-AGENT_TOOL_RESULT_MAX_ITEMS) : [];
        let sandboxSession = run?.sandboxSession || null;
        let draftAnswer = typeof contextSnapshot.draftAnswer === "string" ? contextSnapshot.draftAnswer : "";
        let artifacts = Array.isArray(run?.artifacts) ? run.artifacts.slice() : [];
        let nextAttachmentRecords = Array.isArray(contextSnapshot.attachmentRecords) ? contextSnapshot.attachmentRecords.slice() : [];

        if (sandboxSession?.pendingCommand?.cmdId) {
          const created = await createOrConnectSandbox({
            userId,
            conversationId: conversationObjectId,
            existingSession: sandboxSession,
            allowInternetAccess: true,
          });
          const pendingState = await inspectPendingCommand({
            sandbox: created.sandbox,
            pendingCommand: sandboxSession.pendingCommand,
          });
          if (pendingState.status === "running") {
            await persistSandboxSession({ ...sandboxSession, canResume: true });
            return enterWaitingContinue("沙盒后台任务仍在运行，请继续执行查看结果。");
          }
          if (pendingState.status === "completed" && pendingState.result) {
            sandboxSession = {
              ...sandboxSession,
              latestCommand: pendingState.result,
              pendingCommand: null,
              canResume: false,
            };
            toolResults = [
              ...toolResults,
              createToolEvent(
                "后台命令已完成",
                `${pendingState.result.command || "后台命令"}\n退出码：${pendingState.result.exitCode ?? "未知"}\n${pendingState.result.stdout || pendingState.result.stderr || ""}`,
                { tool: "sandbox_exec", background: true }
              ),
            ].slice(-AGENT_TOOL_RESULT_MAX_ITEMS);
            await persistSandboxSession(sandboxSession);
          }
        }

        const approvedToolCall = run?.approvalRequest?.status === "approved"
          && run?.approvalRequest?.payload?.toolCall
          && typeof run.approvalRequest.payload.toolCall === "object"
          ? run.approvalRequest.payload.toolCall
          : null;
        let approvalGranted = run?.approvalRequest?.status === "approved";

        if (approvedToolCall?.tool) {
          const executed = await executeToolCall({
            toolName: approvedToolCall.tool,
            input: approvedToolCall.input || {},
            userId,
            conversationId: conversationObjectId,
            runId: run._id.toString(),
            sandboxSession,
          });
          sandboxSession = executed.sandboxSession || sandboxSession;
          if (sandboxSession) {
            await persistSandboxSession(sandboxSession);
          }
          if (executed?.artifact) {
            artifacts = [...artifacts, executed.artifact];
            run = await updateRunDocument(run._id, {
              $set: {
                artifacts,
                approvalRequest: null,
                updatedAt: new Date(),
              },
            });
          } else {
            run = await updateRunDocument(run._id, {
              $set: {
                approvalRequest: null,
                updatedAt: new Date(),
              },
            });
          }
          if (executed?.attachmentRecord) {
            nextAttachmentRecords = [...nextAttachmentRecords, executed.attachmentRecord];
          }
          if (executed?.toolEvent) {
            toolResults = [...toolResults, executed.toolEvent].slice(-AGENT_TOOL_RESULT_MAX_ITEMS);
          }
          approvalGranted = false;
          if (executed?.shouldPauseForContinue) {
            run = await updateRunContext(run, {
              toolResults,
              attachmentRecords: nextAttachmentRecords,
              computeContext: buildToolResultsContext(toolResults),
            });
            return enterWaitingContinue("沙盒后台任务已启动，请继续执行查看结果。");
          }
        }

        for (let round = 0; round < AGENT_TOOL_LOOP_MAX_ROUNDS; round += 1) {
          if (shouldYield(startedAt)) {
            run = await updateRunContext(run, {
              toolResults,
              attachmentRecords: nextAttachmentRecords,
              computeContext: buildToolResultsContext(toolResults),
            });
            return enterWaitingContinue();
          }

          const action = await requestToolAction({
            apiKey,
            req,
            prompt: buildToolLoopPrompt({
              goal,
              plan,
              sandboxSession,
              approvalGranted,
              contextSnapshot: {
                ...contextSnapshot,
                toolResults,
                attachmentRecords: nextAttachmentRecords,
              },
            }),
          });

          if (action.action === "final_answer" && action.answer) {
            draftAnswer = action.answer;
            break;
          }

          if (action.action === "approval_request") {
            run = await updateRunContext(run, {
              toolResults,
              attachmentRecords: nextAttachmentRecords,
              computeContext: buildToolResultsContext(toolResults),
            });
            run = await updateRunDocument(run._id, {
              $set: {
                status: "awaiting_approval",
                executionState: AGENT_EXECUTION_STATES.awaitingApproval,
                currentStep: "等待用户确认",
                approvalRequest: {
                  reason: action.reason || "沙盒工具请求需要你的确认。",
                  payload: action.tool
                    ? {
                      toolCall: {
                        tool: action.tool,
                        input: action.input || {},
                      },
                    }
                    : null,
                  status: "pending",
                  decidedAt: null,
                },
                sandboxSession: sandboxSession
                  ? { ...sandboxSession, requiresApproval: true }
                  : sandboxSession,
                updatedAt: new Date(),
              },
            });
            emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
              status: "awaiting_approval",
              executionState: AGENT_EXECUTION_STATES.awaitingApproval,
              canResume: false,
            }));
            return { run, finalAnswer: "", citations: [], status: "awaiting_approval" };
          }

          if (action.action === "tool_call" && action.tool) {
            if (toolCallNeedsApproval(action.tool) && !approvalGranted) {
              run = await updateRunContext(run, {
                toolResults,
                attachmentRecords: nextAttachmentRecords,
                computeContext: buildToolResultsContext(toolResults),
              });
              run = await updateRunDocument(run._id, {
                $set: {
                  status: "awaiting_approval",
                  executionState: AGENT_EXECUTION_STATES.awaitingApproval,
                  currentStep: "等待用户确认",
                  approvalRequest: {
                    reason: `需要执行工具：${action.tool}`,
                    payload: {
                      toolCall: {
                        tool: action.tool,
                        input: action.input || {},
                      },
                    },
                    status: "pending",
                    decidedAt: null,
                  },
                  sandboxSession: sandboxSession
                    ? { ...sandboxSession, requiresApproval: true }
                    : sandboxSession,
                  updatedAt: new Date(),
                },
              });
              emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
                status: "awaiting_approval",
                executionState: AGENT_EXECUTION_STATES.awaitingApproval,
                canResume: false,
              }));
              return { run, finalAnswer: "", citations: [], status: "awaiting_approval" };
            }

            const executed = await executeToolCall({
              toolName: action.tool,
              input: action.input || {},
              userId,
              conversationId: conversationObjectId,
              runId: run._id.toString(),
              sandboxSession,
            });
            sandboxSession = executed.sandboxSession || sandboxSession;
            if (sandboxSession) {
              await persistSandboxSession(sandboxSession);
            }
            if (executed?.artifact) {
              artifacts = [...artifacts, executed.artifact];
              run = await updateRunDocument(run._id, {
                $set: {
                  artifacts,
                  updatedAt: new Date(),
                },
              });
            }
            if (executed?.attachmentRecord) {
              nextAttachmentRecords = [...nextAttachmentRecords, executed.attachmentRecord];
            }
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
            approvalGranted = false;
            if (executed?.shouldPauseForContinue) {
              run = await updateRunContext(run, {
                toolResults,
                attachmentRecords: nextAttachmentRecords,
                computeContext: buildToolResultsContext(toolResults),
              });
              return enterWaitingContinue("沙盒后台任务已启动，请继续执行查看结果。");
            }
            continue;
          }

          break;
        }

        if (!draftAnswer) {
          draftAnswer = await buildFinalSeedAnswer({
            apiKey,
            req,
            model,
            instructions: await injectCurrentTimeSystemReminder(
              buildFinalPrompt({
                goal,
                plan,
                memoryContext: buildMemoryContext(Array.isArray(contextSnapshot.memorySummaries) ? contextSnapshot.memorySummaries : []),
                attachmentContext: contextSnapshot.attachmentContext || "",
                searchContextText: contextSnapshot.searchContextText || "",
                computeContext: [
                  contextSnapshot.attachmentVisualSummary || "",
                  buildToolResultsContext(toolResults),
                ].filter(Boolean).join("\n\n"),
              })
            ),
            historyMessages,
            prompt: goal,
            images: currentImages,
          });
        }

        await finishStep(stepIndex, "tool_loop", {
          outputSummary: clipText(draftAnswer, 600),
          result: {
            toolCount: toolResults.length,
            attachmentRecordCount: nextAttachmentRecords.length,
          },
          contextPatch: {
            attachmentRecords: nextAttachmentRecords,
            toolResults,
            computeContext: buildToolResultsContext(toolResults),
            draftAnswer,
          },
        });
        continue;
      }

      if (stepType === "finalize") {
        const stepIndex = await startStep({
          type: "finalize",
          title: "正在整理交付结果",
          toolName: "finalize",
          inputSummary: "输出答案并写入结果摘要",
        });
        const finalAnswer = typeof contextSnapshot.draftAnswer === "string" ? contextSnapshot.draftAnswer : "";
        const citations = Array.isArray(run.citations) ? run.citations : [];
        let artifacts = Array.isArray(run.artifacts) ? run.artifacts.slice() : [];
        if (finalAnswer.length >= 1200) {
          const artifact = await saveTextArtifact({
            userId,
            conversationId: conversationObjectId,
            runId: run._id.toString(),
            title: "agent-report",
            text: finalAnswer,
          });
          if (artifact) artifacts = [...artifacts, artifact];
        }
        for (const chunk of chunkText(finalAnswer)) {
          sendEvent({ type: "text", content: chunk });
        }
        if (citations.length > 0) sendEvent({ type: "citations", citations });
        run = await patchRunStep(run, stepIndex, {
          status: "done",
          outputSummary: clipText(finalAnswer, 600),
          finishedAt: new Date(),
        });
        run = await saveStepResult(run, "finalize", {
          finalAnswerLength: finalAnswer.length,
          artifactCount: artifacts.length,
        });
        run = await updateRunDocument(run._id, {
          $set: {
            currentCursor: AGENT_STEP_SEQUENCE.length,
            status: "completed",
            executionState: AGENT_EXECUTION_STATES.completed,
            currentStep: "已完成",
            finalAnswer,
            summary: clipText(finalAnswer, 1200),
            lastError: "",
            failureReason: "",
            citations,
            artifacts,
            finishedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        await appendMemoryEntry({
          userId,
          conversationId: conversationObjectId,
          runId: run._id,
          summary: `${run.goal}\n\n${clipText(finalAnswer, 1000)}`,
        });
        emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
          status: "completed",
          executionState: AGENT_EXECUTION_STATES.completed,
          canResume: false,
        }));
        return { run, finalAnswer, citations, status: "completed" };
      }
    }

    return {
      run,
      finalAnswer: run?.finalAnswer || "",
      citations: Array.isArray(run?.citations) ? run.citations : [],
      status: run?.status || "completed",
    };
  } catch (error) {
    run = await updateRunDocument(run._id, {
      $set: {
        status: "failed",
        executionState: AGENT_EXECUTION_STATES.failed,
        lastError: error?.message || "Unknown error",
        failureReason: error?.message || "Unknown error",
        updatedAt: new Date(),
      },
    });
    emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
      status: "failed",
      executionState: AGENT_EXECUTION_STATES.failed,
      canResume: false,
    }));
    throw error;
  } finally {
    await releaseRunLease(run?._id, leaseOwner, leaseToken).catch(() => {});
  }
}
