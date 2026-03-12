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

const AGENT_PLAN_MAX_TOKENS = 1200;
const AGENT_FINAL_MAX_TOKENS = 32000;
const AGENT_MEMORY_MAX_ITEMS = 5;
const AGENT_ATTACHMENT_MAX_CHARS = 12000;
const AGENT_ATTACHMENT_TOTAL_MAX_CHARS = 36000;
const AGENT_HISTORY_SUMMARY_LIMIT = 8;

function clipText(text, maxLength) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function createPlannerFallback({ prompt, attachmentCount, enableWebSearch }) {
  const lower = typeof prompt === "string" ? prompt.toLowerCase() : "";
  const shouldCompute = /统计|汇总|求和|平均|筛选|排序|json|csv|表格|excel|xlsx|xlsx|转换/u.test(prompt || "");
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
    planTitle: typeof base.planTitle === "string" && base.planTitle.trim()
      ? base.planTitle.trim()
      : fallback.planTitle,
    shouldReadAttachments: base.shouldReadAttachments === true || fallback.shouldReadAttachments === true,
    shouldSearch: base.shouldSearch === true || fallback.shouldSearch === true,
    shouldUseMemory: base.shouldUseMemory === true || fallback.shouldUseMemory === true,
    shouldCompute: base.shouldCompute === true || fallback.shouldCompute === true,
    needsApproval: base.needsApproval === true || fallback.needsApproval === true,
    approvalReason: typeof base.approvalReason === "string" && base.approvalReason.trim()
      ? base.approvalReason.trim()
      : fallback.approvalReason,
    outputStyle: typeof base.outputStyle === "string" && base.outputStyle.trim()
      ? base.outputStyle.trim()
      : fallback.outputStyle,
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
          ? message.parts
            .map((part) => typeof part?.text === "string" ? part.text.trim() : "")
            .filter(Boolean)
            .join("\n")
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
    if (typeof item?.url === "string" && item.url) {
      urls.add(item.url);
    }
  }

  for (const message of Array.isArray(historyMessages) ? historyMessages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (typeof part?.fileData?.url === "string" && part.fileData.url) {
        urls.add(part.fileData.url);
      }
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

function buildPlannerInstructions() {
  return injectCurrentTimeSystemReminder(
    "你是一个办公 Agent 的任务规划器。请严格输出 JSON，不要输出 Markdown，不要输出解释。"
  );
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
  nextSteps[stepIndex] = {
    ...nextSteps[stepIndex],
    ...patch,
  };
  return updateRunDocument(run._id, {
    $set: {
      steps: nextSteps,
      currentStep: nextSteps[stepIndex]?.title || run.currentStep,
      updatedAt: new Date(),
    },
  });
}

function emitAgentStatus(sendEvent, payload) {
  sendEvent({
    type: "agent_status",
    ...payload,
  });
}

function emitAgentStep(sendEvent, step) {
  sendEvent({
    type: "agent_step",
    step,
  });
}

function emitAgentThought(sendEvent, text) {
  if (!isNonEmptyString(text)) return;
  sendEvent({
    type: "thought",
    content: text,
  });
}

function buildAgentMessageMeta(run, extra = {}) {
  return {
    runId: run?._id?.toString?.() || "",
    status: run?.status || "running",
    currentStep: run?.currentStep || "",
    canResume: run?.status === "waiting_user" || extra.canResume === true,
    lastError: run?.lastError || "",
    approvalReason: run?.approvalRequest?.reason || "",
    approvalStatus: run?.approvalRequest?.status || "",
    ...extra,
  };
}

async function loadMemorySummaries(userId) {
  const entries = await MemoryEntry.find({ userId, scope: "agent" })
    .sort({ updatedAt: -1 })
    .limit(AGENT_MEMORY_MAX_ITEMS)
    .lean();

  return entries
    .map((entry) => clipText(entry?.summary, 600))
    .filter(Boolean);
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
      const rowCount = Number(item?.rowCount) || 0;
      const sheetCount = Number(item?.sheetCount) || 0;
      summaries.push(`${file.name}：表格共 ${sheetCount || 1} 个工作表，约 ${rowCount} 行内容。`);
      continue;
    }
    if (file.extension === "json") {
      const parsed = tryParseJson(extractedText);
      if (Array.isArray(parsed)) {
        summaries.push(`${file.name}：JSON 数组，共 ${parsed.length} 条记录。`);
      } else if (parsed && typeof parsed === "object") {
        summaries.push(`${file.name}：JSON 对象，共 ${Object.keys(parsed).length} 个顶级字段。`);
      }
      continue;
    }
    if (file.category === "data" || file.category === "code" || file.category === "text") {
      const lineCount = extractedText ? extractedText.split("\n").length : 0;
      summaries.push(`${file.name}：约 ${lineCount} 行文本内容。`);
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
  return memorySummaries
    .map((item, index) => `记忆 ${index + 1}：${item}`)
    .join("\n");
}

function buildPlannerSummary(plan) {
  if (!plan) return "";
  const steps = Array.isArray(plan.steps) ? plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "";
  return [plan.planTitle, steps].filter(Boolean).join("\n");
}

function buildFinalPrompt({
  goal,
  plan,
  memoryContext,
  attachmentContext,
  searchContextText,
  computeContext,
}) {
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

async function buildPlannerDecision({
  apiKey,
  req,
  prompt,
  historyMessages,
  attachmentCount,
  enableWebSearch,
}) {
  const plannerInput = [
    buildSeedMessageInput({
      role: "user",
      content: [{ type: "input_text", text: buildPlannerPrompt({ prompt, historyMessages, attachmentCount, enableWebSearch }) }],
    }),
  ];
  const plannerRequest = buildSeedJsonRequestBody({
    model: SEED_MODEL_ID,
    input: plannerInput,
    instructions: await buildPlannerInstructions(),
    maxTokens: AGENT_PLAN_MAX_TOKENS,
  });

  const fallback = createPlannerFallback({ prompt, attachmentCount, enableWebSearch });
  try {
    const result = await requestSeedJson({ apiKey, requestBody: plannerRequest, req });
    const parsed = parseJsonFromText(result.text);
    return normalizePlannerDecision(parsed, fallback);
  } catch {
    return fallback;
  }
}

async function runSeedDecision({
  apiKey,
  req,
  prompt,
  historyMessages,
  searchRounds,
}) {
  const { systemText, userText } = await buildWebSearchDecisionPrompts({
    prompt,
    historyMessages,
    searchRounds,
  });

  const requestBody = buildSeedJsonRequestBody({
    model: SEED_MODEL_ID,
    input: [
      buildSeedMessageInput({
        role: "user",
        content: [{ type: "input_text", text: userText }],
      }),
    ],
    instructions: systemText,
    maxTokens: WEB_SEARCH_DECISION_MAX_OUTPUT_TOKENS,
    temperature: 0.1,
  });

  const result = await requestSeedJson({ apiKey, requestBody, req });
  return result.text;
}

async function buildFinalSeedAnswer({
  apiKey,
  req,
  model,
  instructions,
  historyMessages,
  prompt,
  images,
}) {
  const input = await buildBytedanceInputFromHistory(historyMessages || []);
  const userContent = [];

  if (isNonEmptyString(prompt)) {
    userContent.push({ type: "input_text", text: prompt });
  }

  if (Array.isArray(images)) {
    for (const item of images) {
      if (!item?.url) continue;
      const { base64Data, mimeType } = await fetchImageAsBase64(item.url);
      userContent.push({
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64Data}`,
      });
    }
  }

  if (userContent.length > 0) {
    input.push(buildSeedMessageInput({ role: "user", content: userContent }));
  }

  const finalRequestBody = buildSeedJsonRequestBody({
    model: resolveSeedRuntimeModelId(model),
    input,
    instructions,
    maxTokens: AGENT_FINAL_MAX_TOKENS,
    temperature: 0.35,
  });

  const finalResult = await requestSeedJson({ apiKey, requestBody: finalRequestBody, req });
  return finalResult.text;
}

export async function runAgentRuntime({
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
  const currentAttachments = Array.isArray(attachments) ? attachments : [];
  const currentImages = Array.isArray(images) ? images : [];
  const enableWebSearch = config?.webSearch === true;

  let run = null;
  if (resume && isNonEmptyString(runId)) {
    run = await AgentRun.findOne({
      _id: runId,
      userId,
      conversationId: conversationObjectId,
    });
    if (!run) {
      throw new Error("未找到可继续的 Agent 任务");
    }
  } else {
    run = await AgentRun.create({
      userId,
      conversationId: conversationObjectId,
      model: runtimeModel,
      goal: prompt || "继续执行 Agent 任务",
      status: "running",
      currentStep: "开始处理",
      metadata: {
        attachments: currentAttachments,
        imageCount: currentImages.length,
        webSearch: enableWebSearch,
      },
    });
  }

  emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
    status: "running",
    canResume: false,
  }));

  if (resume && run.status === "waiting_user") {
    const approved = approvalDecision === "approved" || approvalDecision === true;
    if (!approved) {
      throw new Error("继续执行前需要确认");
    }
    run = await updateRunDocument(run._id, {
      $set: {
        status: "running",
        "approvalRequest.status": "approved",
        "approvalRequest.decidedAt": new Date(),
        updatedAt: new Date(),
      },
    });
  }

  const planningStep = {
    stepOrder: (run.steps?.length || 0) + 1,
    type: "plan",
    title: "正在规划任务",
    status: "running",
    toolName: null,
    inputSummary: clipText(prompt || run.goal, 300),
    outputSummary: "",
    startedAt: new Date(),
    finishedAt: null,
  };

  let stepIndexInfo = await createRunStep(run, planningStep);
  run = stepIndexInfo.run;
  emitAgentThought(sendEvent, "正在规划这个任务的处理方式...\n");

  const plan = await buildPlannerDecision({
    apiKey,
    req,
    prompt: prompt || run.goal,
    historyMessages,
    attachmentCount: countPlannableAttachments(historyMessages, currentAttachments),
    enableWebSearch,
  });

  run = await patchRunStep(run, stepIndexInfo.stepIndex, {
    status: "done",
    outputSummary: buildPlannerSummary(plan),
    finishedAt: new Date(),
  });
  emitAgentThought(sendEvent, `已确定执行方向：${plan.planTitle}。\n`);

  const approvalNeeded = plan.needsApproval === true && !(resume && approvalDecision === "approved");
  if (approvalNeeded) {
    run = await updateRunDocument(run._id, {
      $set: {
        status: "waiting_user",
        currentStep: "等待用户确认",
        approvalRequest: {
          reason: plan.approvalReason || "本次任务需要继续读取资料或联网，请确认后再继续。",
          payload: {
            attachments: currentAttachments.length,
            webSearch: plan.shouldSearch === true,
          },
          status: "pending",
        },
        updatedAt: new Date(),
      },
    });

    emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
      status: "waiting_user",
      canResume: true,
    }));
    return {
      run,
      finalAnswer: "",
      citations: [],
      status: "waiting_user",
    };
  }

  let memorySummaries = [];
  if (plan.shouldUseMemory) {
    const memoryStep = {
      stepOrder: (run.steps?.length || 0) + 1,
      type: "memory",
      title: "正在读取会话记忆",
      status: "running",
      toolName: "memory_lookup",
      inputSummary: "读取最近的 Agent 任务摘要",
      outputSummary: "",
      startedAt: new Date(),
      finishedAt: null,
    };
    stepIndexInfo = await createRunStep(run, memoryStep);
    run = stepIndexInfo.run;
    emitAgentThought(sendEvent, "正在结合当前会话上下文...\n");

    memorySummaries = await loadMemorySummaries(userId);
    run = await patchRunStep(run, stepIndexInfo.stepIndex, {
      status: "done",
      outputSummary: memorySummaries.length > 0
        ? `已读取 ${memorySummaries.length} 条记忆`
        : "没有可用的近期记忆",
      finishedAt: new Date(),
    });
    emitAgentThought(sendEvent, memorySummaries.length > 0 ? "已结合当前会话里的相关上下文。\n" : "当前没有可参考的近期会话记忆。\n");
  }

  let preparedAttachments = [];
  if (plan.shouldReadAttachments) {
    const attachmentUrls = new Set(
      currentAttachments
        .map((item) => item?.url)
        .filter(Boolean)
    );
    for (const message of historyMessages || []) {
      for (const part of Array.isArray(message?.parts) ? message.parts : []) {
        if (part?.fileData?.url) attachmentUrls.add(part.fileData.url);
      }
    }

    if (attachmentUrls.size > 0) {
      const readerStep = {
        stepOrder: (run.steps?.length || 0) + 1,
        type: "reader",
        title: "正在读取附件资料",
        status: "running",
        toolName: "read_attachments",
        inputSummary: `准备读取 ${attachmentUrls.size} 个附件`,
        outputSummary: "",
        startedAt: new Date(),
        finishedAt: null,
      };
      stepIndexInfo = await createRunStep(run, readerStep);
      run = stepIndexInfo.run;
      emitAgentStep(sendEvent, {
        id: `agent_step_${Date.now()}_${readerStep.stepOrder}`,
        kind: "reader",
        status: "running",
        title: readerStep.title,
        message: readerStep.inputSummary,
      });

      const preparedMap = await getPreparedAttachmentTextsByUrls(Array.from(attachmentUrls), { userId });
      preparedAttachments = Array.from(preparedMap.values());
      run = await patchRunStep(run, stepIndexInfo.stepIndex, {
        status: "done",
        outputSummary: preparedAttachments.length > 0
          ? `已读取 ${preparedAttachments.length} 个附件`
          : "没有读取到可用附件内容",
        finishedAt: new Date(),
      });
      emitAgentStep(sendEvent, {
        id: `agent_step_${Date.now()}_${readerStep.stepOrder}_done`,
        kind: "reader",
        status: "done",
        title: "附件资料已读取",
        content: preparedAttachments.length > 0
          ? preparedAttachments.map((item) => `${item.file?.name || "附件"}：已提取文本`).join("\n")
          : "没有读取到可用附件内容",
      });
    }
  }

  let searchContextText = "";
  let citations = [];
  if (plan.shouldSearch && enableWebSearch) {
    const searchStep = {
      stepOrder: (run.steps?.length || 0) + 1,
      type: "search",
      title: "正在联网搜索",
      status: "running",
      toolName: "web_search",
      inputSummary: clipText(prompt || run.goal, 180),
      outputSummary: "",
      startedAt: new Date(),
      finishedAt: null,
    };
    stepIndexInfo = await createRunStep(run, searchStep);
    run = stepIndexInfo.run;
    emitAgentThought(sendEvent, "正在联网补充相关信息...\n");

    const seedWebSearchRuntime = getWebSearchProviderRuntimeOptions("seed");
    const citationList = [];
    const searchResult = await runWebSearchOrchestration({
      enableWebSearch: true,
      prompt: prompt || run.goal,
      historyMessages,
      decisionRunner: ({ prompt: decisionPrompt, historyMessages: decisionHistory, searchRounds }) =>
        runSeedDecision({
          apiKey,
          req,
          prompt: decisionPrompt,
          historyMessages: decisionHistory,
          searchRounds,
        }),
      sendEvent,
      pushCitations: (items) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item?.url) continue;
          if (!citationList.some((citation) => citation.url === item.url)) {
            citationList.push(item);
          }
        }
      },
      sendSearchError: (message, details = {}) => {
        sendEvent({ type: "search_error", message, ...details });
      },
      model: resolveSeedRuntimeModelId(model),
      conversationId: conversationObjectId?.toString?.() || "",
      providerLabel: "Agent",
      ...seedWebSearchRuntime,
    });

    searchContextText = searchResult?.searchContextText || "";
    citations = citationList;
    run = await patchRunStep(run, stepIndexInfo.stepIndex, {
      status: "done",
      outputSummary: searchContextText ? "已完成联网资料收集" : "联网没有拿到有效补充资料",
      finishedAt: new Date(),
    });
    emitAgentThought(sendEvent, searchContextText ? "联网资料已经补充完成。\n" : "联网没有拿到有效补充资料。\n");
  }

  let computeContext = "";
  if (plan.shouldCompute) {
    const computeStep = {
      stepOrder: (run.steps?.length || 0) + 1,
      type: "compute",
      title: "正在整理结构化结果",
      status: "running",
      toolName: "structured_compute",
      inputSummary: "对附件中的数据和文本做整理",
      outputSummary: "",
      startedAt: new Date(),
      finishedAt: null,
    };
    stepIndexInfo = await createRunStep(run, computeStep);
    run = stepIndexInfo.run;
    emitAgentThought(sendEvent, "正在整理资料里的结构化信息...\n");

    computeContext = runStructuredCompute({
      prompt: prompt || run.goal,
      preparedAttachments,
    });
    run = await patchRunStep(run, stepIndexInfo.stepIndex, {
      status: "done",
      outputSummary: computeContext || "没有可整理的结构化结果",
      finishedAt: new Date(),
    });
    emitAgentThought(sendEvent, computeContext ? "结构化整理已经完成。\n" : "当前没有可整理的结构化结果。\n");
  }

  const attachmentContext = buildAttachmentContext(preparedAttachments);
  const memoryContext = buildMemoryContext(memorySummaries);
  const finalInstructions = await injectCurrentTimeSystemReminder(
    buildFinalPrompt({
      goal: prompt || run.goal,
      plan,
      memoryContext,
      attachmentContext,
      searchContextText,
      computeContext,
    })
  );

  const draftStep = {
    stepOrder: (run.steps?.length || 0) + 1,
    type: "draft",
    title: "正在生成最终结果",
    status: "running",
    toolName: null,
    inputSummary: "整合已有资料并输出答案",
    outputSummary: "",
    startedAt: new Date(),
    finishedAt: null,
  };
  stepIndexInfo = await createRunStep(run, draftStep);
  run = stepIndexInfo.run;
  const draftStepIndex = stepIndexInfo.stepIndex;
  emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
    status: "running",
    canResume: false,
  }));
  emitAgentThought(sendEvent, "正在组织最终回答...\n");

  const draftAnswer = await buildFinalSeedAnswer({
    apiKey,
    req,
    model,
    instructions: finalInstructions,
    historyMessages,
    prompt,
    images: currentImages,
  });

  run = await patchRunStep(run, draftStepIndex, {
    status: "done",
    outputSummary: clipText(draftAnswer, 600),
    finishedAt: new Date(),
  });

  const finalAnswer = draftAnswer;

  for (const chunk of chunkText(finalAnswer)) {
    sendEvent({ type: "text", content: chunk });
  }

  if (citations.length > 0) {
    sendEvent({ type: "citations", citations });
  }

  run = await updateRunDocument(run._id, {
    $set: {
      status: "completed",
      currentStep: "已完成",
      finalAnswer,
      summary: clipText(finalAnswer, 1200),
      lastError: "",
      finishedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  emitAgentStatus(sendEvent, buildAgentMessageMeta(run, {
    status: "completed",
    canResume: false,
  }));

  await appendMemoryEntry({
    userId,
    conversationId: conversationObjectId,
    runId: run._id,
    summary: `${run.goal}\n\n${clipText(finalAnswer, 1000)}`,
  });

  return {
    run,
    finalAnswer,
    citations,
    status: "completed",
  };
}
