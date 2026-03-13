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
import { buildAttachmentTextBlock, getPreparedAttachmentTextsByUrls } from "@/lib/server/files/service";
import { WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS, getWebSearchProviderRuntimeOptions } from "@/lib/server/chat/webSearchConfig";
import { AGENT_MODEL_ID, resolveSeedRuntimeModelId, SEED_MODEL_ID } from "@/lib/shared/models";
import { buildSeedJsonRequestBody, requestSeedJson } from "@/lib/server/seed/service";
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

function clipText(text, maxLength) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function createPlannerFallback({ prompt, attachmentCount, enableWebSearch }) {
  const shouldCompute = /统计|汇总|求和|平均|筛选|排序|json|csv|表格|excel|xlsx|转换/u.test(prompt || "");
  const shouldSearch = enableWebSearch === true && /最新|最近|官网|新闻|公告|价格|汇率|天气|查一下|搜一下|联网/u.test(prompt || "");
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
    "如果用户问题明显依赖最新信息，再开启 shouldSearch。",
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
    const extractedText = clipText(item?.extractedText || "", AGENT_ATTACHMENT_MAX_CHARS);
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
    attachmentSummaries: [],
    attachmentContext: "",
    attachmentCompareSummary: "",
    structuredJsonOutputs: [],
    searchDecisions: [],
    searchContextText: "",
    computeContext: "",
    draftAnswer: "",
  };
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
    run = await AgentRun.create({
      userId,
      conversationId: conversationObjectId,
      model: runtimeModel,
      goal: runtimePrompt || "继续执行 Agent 任务",
      runVersion: 2,
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

  const enterWaitingContinue = async (reason = "当前轮次已接近时限，准备继续下一轮执行。") => {
    await heartbeat();
    run = await updateRunDocument(run._id, {
      $set: {
        status: "waiting_continue",
        executionState: AGENT_EXECUTION_STATES.waitingContinue,
        currentStep: "等待继续执行",
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

        const memorySummaries = await loadMemorySummaries(userId);
        await finishStep(stepIndex, "memory", {
          outputSummary: memorySummaries.length > 0 ? `已读取 ${memorySummaries.length} 条记忆` : "没有可用的近期记忆",
          result: { count: memorySummaries.length },
          contextPatch: { memorySummaries },
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
        const preparedList = await mapWithConcurrency(attachmentUrls, AGENT_ATTACHMENT_CONCURRENCY, async (url) => {
          const preparedMap = await getPreparedAttachmentTextsByUrls([url], { userId });
          return preparedMap.get(url) || null;
        });
        const preparedAttachments = preparedList.filter(Boolean);
        const attachmentSummaries = preparedAttachments.map((item) => ({
          name: item.file?.name || "附件",
          extension: item.file?.extension || "",
          category: item.file?.category || "",
          pageCount: Number(item?.pageCount) || 0,
          sheetCount: Number(item?.sheetCount) || 0,
          rowCount: Number(item?.rowCount) || 0,
        }));
        await finishStep(stepIndex, "attachment_read", {
          outputSummary: preparedAttachments.length > 0 ? `已读取 ${preparedAttachments.length} 个附件` : "没有读取到可用附件内容",
          result: { count: preparedAttachments.length, names: attachmentSummaries.map((item) => item.name) },
          contextPatch: {
            attachmentSummaries,
            attachmentContext: buildAttachmentContext(preparedAttachments),
            attachmentCompareSummary: buildAttachmentCompareSummary(preparedAttachments),
            structuredJsonOutputs: buildStructuredJsonOutputs(preparedAttachments),
          },
        });
        emitAgentStep(sendEvent, {
          id: `agent_attachment_read_${Date.now()}_done`,
          kind: "reader",
          status: "done",
          title: "附件资料已读取",
          content: preparedAttachments.length > 0 ? attachmentSummaries.map((item) => `${item.name}：已提取文本`).join("\n") : "没有读取到可用附件内容",
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

      if (stepType === "compute") {
        if (!plan?.shouldCompute) {
          await skipStep("compute", "跳过结构化整理");
          continue;
        }
        const stepIndex = await startStep({
          type: "compute",
          title: "正在整理结构化结果",
          toolName: "structured_compute",
          inputSummary: "对附件中的数据和文本做整理",
        });

        const preparedMap = await getPreparedAttachmentTextsByUrls(attachmentUrls, { userId });
        const preparedAttachments = Array.from(preparedMap.values());
        const computeContext = [
          runStructuredCompute({ prompt: goal, preparedAttachments }),
          contextSnapshot.attachmentCompareSummary || "",
          Array.isArray(contextSnapshot.structuredJsonOutputs) && contextSnapshot.structuredJsonOutputs.length > 0
            ? `已提取 JSON 结构：\n${contextSnapshot.structuredJsonOutputs.map((item) => `${item.name}：${item.type}\n${item.preview}`).join("\n\n")}`
            : "",
        ].filter(Boolean).join("\n\n");
        await finishStep(stepIndex, "compute", {
          outputSummary: computeContext || "没有可整理的结构化结果",
          result: { hasComputeContext: Boolean(computeContext) },
          contextPatch: { computeContext },
        });
        continue;
      }

      if (stepType === "draft") {
        const stepIndex = await startStep({
          type: "draft",
          title: "正在生成最终结果",
          inputSummary: "整合已有资料并输出答案",
        });

        const draftAnswer = await buildFinalSeedAnswer({
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
              computeContext: contextSnapshot.computeContext || "",
            })
          ),
          historyMessages,
          prompt: goal,
          images: currentImages,
        });
        await finishStep(stepIndex, "draft", {
          outputSummary: clipText(draftAnswer, 600),
          result: { preview: clipText(draftAnswer, 600) },
          contextPatch: { draftAnswer },
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
