import MemoryEntry from "@/models/MemoryEntry";
import { parseJsonFromText } from "@/app/api/chat/jsonUtils";
import { runAgentControlText, streamAgentFinalAnswer } from "@/lib/server/agent/driverAnswer";
import {
  injectCurrentTimeSystemReminder,
  isNonEmptyString,
} from "@/app/api/chat/utils";
import {
  buildAttachmentTextBlock,
  prepareDocumentAttachment,
} from "@/lib/server/files/service";
import { parseWebSearchEnabled } from "@/lib/server/chat/requestConfig";
import { buildWebBrowsingContextBlock } from "@/lib/server/webBrowsing/session";
import {
  WEB_BROWSING_IDENTIFIER,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
  WebBrowsingApiName,
} from "@/lib/server/webBrowsing/types";
import {
  createRuntimeExecutors,
  VERCEL_SANDBOX_IDENTIFIER,
  VercelSandboxApiName,
} from "@/lib/server/agent/core/runtimeExecutors";
import { createToolCall } from "@/lib/server/agent/core/eventProtocol";

const AGENT_PLAN_MAX_TOKENS = 1200;
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
    outputStyle: "用简体中文，大白话，结论优先。",
    planTitle: "处理当前 Agent 任务",
    shouldReadAttachments: attachmentCount > 0,
    shouldSearch,
    shouldUseMemory,
    shouldUseSandbox,
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
    outputStyle: typeof base.outputStyle === "string" && base.outputStyle.trim() ? base.outputStyle.trim() : fallback.outputStyle,
    planTitle: typeof base.planTitle === "string" && base.planTitle.trim() ? base.planTitle.trim() : fallback.planTitle,
    shouldReadAttachments: base.shouldReadAttachments === true || fallback.shouldReadAttachments === true,
    shouldSearch: base.shouldSearch === true || fallback.shouldSearch === true,
    shouldUseMemory: base.shouldUseMemory === true || fallback.shouldUseMemory === true,
    shouldUseSandbox: base.shouldUseSandbox === true || fallback.shouldUseSandbox === true,
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

async function buildPlannerDecision({ apiKey, req, userId, driverModel, prompt, historyMessages, attachmentCount, enableWebSearch, thinkingLevel }) {
  const fallback = buildPlannerFallback({ prompt, attachmentCount, enableWebSearch });
  try {
    const resultText = await runAgentControlText({
      apiKey,
      req,
      userId,
      driverModel,
      systemPrompt: await injectCurrentTimeSystemReminder("你是一个同步 Agent 的任务规划器。请严格输出 JSON，不要输出解释。"),
      userText: buildPlannerPrompt({ prompt, historyMessages, attachmentCount, enableWebSearch }),
      maxTokens: AGENT_PLAN_MAX_TOKENS,
      thinkingLevel,
      temperature: 0.1,
    });
    const parsed = parseJsonFromText(resultText);
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

function buildToolLoopPrompt({
  goal,
  plan,
  searchContextText,
  attachmentContext,
  preparedAttachments,
  sandboxSession,
  toolResults,
  allowWebSearch,
  allowSandbox,
}) {
  const availableActions = [];
  if (allowSandbox) {
    availableActions.push(
      '{"instruction":"call_tool","toolCall":{"identifier":"vectaix-vercel-sandbox","apiName":"exec","arguments":{"command":"ls -la","cwd":"/vercel/sandbox/vectaix"},"type":"builtin"}}',
      '{"instruction":"call_tool","toolCall":{"identifier":"vectaix-vercel-sandbox","apiName":"uploadBlob","arguments":{"url":"https://...","remotePath":"/path/file.txt"},"type":"builtin"}}',
      '{"instruction":"call_tool","toolCall":{"identifier":"vectaix-vercel-sandbox","apiName":"readFile","arguments":{"path":"/path/file.txt"},"type":"builtin"}}',
      '{"instruction":"call_tool","toolCall":{"identifier":"vectaix-vercel-sandbox","apiName":"downloadArtifact","arguments":{"path":"/path/file.txt","title":"result","mimeType":"text/plain","extension":"txt"},"type":"builtin"}}'
    );
  }
  if (allowWebSearch) {
    availableActions.push(
      '{"instruction":"call_tool","toolCall":{"identifier":"lobe-web-browsing","apiName":"search","arguments":{"query":"OpenAI Responses API docs","searchCategories":["general"],"searchTimeRange":"day"},"type":"builtin"}}',
      '{"instruction":"call_tool","toolCall":{"identifier":"lobe-web-browsing","apiName":"crawlSinglePage","arguments":{"url":"https://example.com"},"type":"builtin"}}',
      '{"instruction":"call_tool","toolCall":{"identifier":"lobe-web-browsing","apiName":"crawlMultiPages","arguments":{"urls":["https://example.com","https://example.org"]},"type":"builtin"}}'
    );
  }

  return [
    "你是同步 Agent 的指令执行器，只能在当前请求里做完事情。",
    "严格只返回 JSON。",
    "只允许两种 instruction：call_tool 或 finish。",
    "如果已经拿到足够信息，必须返回 finish。",
    "可选 JSON 示例：",
    ...availableActions,
    '{"instruction":"finish","answer":"..."}',
    "禁止输出后台命令，禁止输出 approval，禁止输出 continue，禁止输出 resume。",
    `用户任务：${goal}`,
    plan?.planTitle ? `计划：${plan.planTitle}` : "",
    attachmentContext ? `附件摘要：\n${attachmentContext}` : "",
    searchContextText ? `联网资料：\n${searchContextText}` : "",
    `当前附件可用信息：\n${buildAvailableAttachmentList(preparedAttachments)}`,
    sandboxSession?.workdir ? `当前沙盒工作目录：${sandboxSession.workdir}` : "当前还没有沙盒会话，如需执行工具可直接调用。",
    toolResults.length > 0 ? `最近工具结果：\n${buildToolResultsContext(toolResults)}` : "",
  ].filter(Boolean).join("\n\n");
}

function normalizeToolCall(toolCall, { allowSandbox, allowWebSearch }) {
  const candidate = toolCall && typeof toolCall === "object" ? toolCall : {};
  const identifier = typeof candidate.identifier === "string" ? candidate.identifier.trim() : "";
  const apiName = typeof candidate.apiName === "string" ? candidate.apiName.trim() : "";
  const args = candidate.arguments && typeof candidate.arguments === "object" ? candidate.arguments : {};

  if (allowWebSearch && identifier === WEB_BROWSING_IDENTIFIER) {
    if (
      apiName === WebBrowsingApiName.search
      || apiName === WebBrowsingApiName.crawlSinglePage
      || apiName === WebBrowsingApiName.crawlMultiPages
    ) {
      return createToolCall({
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        identifier,
        apiName,
        arguments: args,
      });
    }
  }

  if (allowSandbox && identifier === VERCEL_SANDBOX_IDENTIFIER) {
    if (
      apiName === VercelSandboxApiName.exec
      || apiName === VercelSandboxApiName.uploadBlob
      || apiName === VercelSandboxApiName.readFile
      || apiName === VercelSandboxApiName.downloadArtifact
    ) {
      return createToolCall({
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        identifier,
        apiName,
        arguments: args,
      });
    }
  }

  return null;
}

function normalizeInstruction(rawAction, options) {
  const candidate = typeof rawAction === "string" ? parseJsonFromText(rawAction) : rawAction;
  if (!candidate || typeof candidate !== "object") {
    return { instruction: "finish", answer: "" };
  }

  if (candidate.instruction === "call_tool") {
    const toolCall = normalizeToolCall(candidate.toolCall, options);
    if (toolCall) {
      return {
        instruction: "call_tool",
        toolCall,
      };
    }
  }

  return {
    instruction: "finish",
    answer: typeof candidate.answer === "string" ? candidate.answer.trim() : "",
  };
}

async function requestNextInstruction({ apiKey, req, userId, driverModel, prompt, thinkingLevel, allowSandbox, allowWebSearch }) {
  const resultText = await runAgentControlText({
    apiKey,
    req,
    userId,
    driverModel,
    systemPrompt: await injectCurrentTimeSystemReminder("你是 Vectaix Agent 的同步指令执行器，只能输出 JSON。"),
    userText: prompt,
    maxTokens: 900,
    thinkingLevel,
    temperature: 0.1,
  });
  return normalizeInstruction(resultText, { allowSandbox, allowWebSearch });
}

function buildToolView(toolCall) {
  if (toolCall.identifier === WEB_BROWSING_IDENTIFIER) {
    if (toolCall.apiName === WebBrowsingApiName.search) return { title: "联网搜索" };
    if (toolCall.apiName === WebBrowsingApiName.crawlSinglePage) return { title: "抓取网页" };
    return { title: "抓取多个网页" };
  }

  if (toolCall.identifier === VERCEL_SANDBOX_IDENTIFIER) {
    if (toolCall.apiName === VercelSandboxApiName.exec) return { title: "执行沙盒命令" };
    if (toolCall.apiName === VercelSandboxApiName.uploadBlob) return { title: "上传文件到沙盒" };
    if (toolCall.apiName === VercelSandboxApiName.readFile) return { title: "读取沙盒文件" };
    return { title: "导出沙盒产物" };
  }

  return { title: "执行工具" };
}

function buildToolSummary(toolCall, result) {
  if (toolCall.identifier === WEB_BROWSING_IDENTIFIER && toolCall.apiName === WebBrowsingApiName.search) {
    const count = Number(result?.state?.resultNumbers) || (Array.isArray(result?.state?.results) ? result.state.results.length : 0);
    return clipText(`${toolCall.arguments?.query || ""}\n${result?.success === false ? (result?.content || "搜索失败") : `共 ${count} 条结果`}`, AGENT_TOOL_RESULT_MAX_CHARS);
  }

  if (toolCall.identifier === WEB_BROWSING_IDENTIFIER) {
    const urls = toolCall.apiName === WebBrowsingApiName.crawlSinglePage
      ? [toolCall.arguments?.url || ""]
      : (Array.isArray(toolCall.arguments?.urls) ? toolCall.arguments.urls : []);
    const count = Array.isArray(result?.state?.results) ? result.state.results.length : 0;
    return clipText(`${urls.filter(Boolean).join("\n")}\n${result?.success === false ? (result?.content || "抓取失败") : `共 ${count} 页结果`}`, AGENT_TOOL_RESULT_MAX_CHARS);
  }

  if (toolCall.identifier === VERCEL_SANDBOX_IDENTIFIER && toolCall.apiName === VercelSandboxApiName.exec) {
    return clipText(`${toolCall.arguments?.command || ""}\n${result?.content || ""}`, AGENT_TOOL_RESULT_MAX_CHARS);
  }

  if (toolCall.identifier === VERCEL_SANDBOX_IDENTIFIER && toolCall.apiName === VercelSandboxApiName.readFile) {
    return clipText(`${toolCall.arguments?.path || ""}\n${result?.content || ""}`, AGENT_TOOL_RESULT_MAX_CHARS);
  }

  return clipText(result?.content || "", AGENT_TOOL_RESULT_MAX_CHARS);
}

function buildCompactToolState(toolCall, result) {
  if (!result?.state || typeof result.state !== "object") return {};

  if (toolCall.identifier === WEB_BROWSING_IDENTIFIER && toolCall.apiName === WebBrowsingApiName.search) {
    return {
      query: toolCall.arguments?.query || "",
      resultNumbers: Number(result?.state?.resultNumbers) || 0,
      results: Array.isArray(result?.state?.results)
        ? result.state.results.slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT).map((item) => ({
          title: item?.title || "",
          url: item?.url || "",
          content: clipText(item?.content || "", 800),
          publishedDate: item?.publishedDate || "",
        }))
        : [],
    };
  }

  if (toolCall.identifier === WEB_BROWSING_IDENTIFIER) {
    return {
      results: Array.isArray(result?.state?.results)
        ? result.state.results.slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT).map((item) => ({
          originalUrl: item?.originalUrl || "",
          data: {
            title: item?.data?.title || "",
            url: item?.data?.url || item?.originalUrl || "",
            description: item?.data?.description || "",
            contentType: item?.data?.contentType || "",
            content: clipText(item?.data?.content || "", 2000),
            errorMessage: item?.data?.errorMessage || "",
          },
        }))
        : [],
    };
  }

  return result.state;
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

export async function runInstructionEngine({
  apiKey,
  attachments = [],
  config = {},
  conversationId,
  coordinator,
  driverModel,
  historyMessages = [],
  images = [],
  prompt,
  req,
  userId,
}) {
  const goal = isNonEmptyString(prompt) ? prompt.trim() : "请处理当前任务";
  const thinkingLevel = typeof config?.thinkingLevel === "string" && config.thinkingLevel
    ? config.thinkingLevel
    : "high";
  const enableWebSearch = parseWebSearchEnabled(config?.webSearch);

  const planningStep = coordinator.startStep({
    kind: "planner",
    title: "正在制定执行计划",
    content: "分析当前任务目标",
  });

  const plan = await buildPlannerDecision({
    apiKey,
    req,
    userId,
    driverModel,
    prompt: goal,
    historyMessages,
    attachmentCount: countPlannableAttachments(historyMessages, attachments),
    enableWebSearch,
    thinkingLevel,
  });

  coordinator.completeStep(planningStep.id, {
    status: "done",
    title: "执行计划已确定",
    content: [plan.planTitle, ...(Array.isArray(plan.steps) ? plan.steps.map((step, index) => `${index + 1}. ${step}`) : [])].join("\n"),
  });

  const memorySummaries = plan.shouldUseMemory ? await loadMemorySummaries(userId) : [];
  const memoryContext = memorySummaries.length > 0
    ? memorySummaries.map((item, index) => `记忆 ${index + 1}：${item}`).join("\n")
    : "";

  let preparedAttachments = [];
  let attachmentSandboxSession = null;
  if (plan.shouldReadAttachments && Array.isArray(attachments) && attachments.length > 0) {
    const attachmentStep = coordinator.startStep({
      kind: "reader",
      title: "正在读取附件资料",
      content: `${attachments.length} 个附件`,
    });

    for (const attachment of attachments) {
      throwIfAborted(req?.signal);
      if (!attachment?.url) continue;
      const prepared = await prepareDocumentAttachment({
        userId,
        url: attachment.url,
        conversationId,
        sandboxSession: attachmentSandboxSession,
        signal: req?.signal,
      });
      if (prepared?.prepared) preparedAttachments.push(prepared.prepared);
      if (prepared?.sandboxSession) attachmentSandboxSession = prepared.sandboxSession;
    }

    coordinator.completeStep(attachmentStep.id, {
      status: "done",
      title: "附件资料已读取",
      content: preparedAttachments.length > 0
        ? preparedAttachments.map(buildPreparedAttachmentSummary).join("\n")
        : "没有读取到可用附件内容",
    });
  }

  let searchContextText = "";
  let webBrowsingToolCalls = [];
  let toolResults = [];
  const allowWebSearch = plan.shouldSearch && enableWebSearch === true;
  const allowSandbox = plan.shouldUseSandbox === true;
  const runtimes = createRuntimeExecutors({
    conversationId,
    initialSandboxSession: attachmentSandboxSession,
    userId,
    webSearchOptions: config?.webSearch,
  });

  if (allowSandbox || allowWebSearch) {
    const toolPhaseStep = coordinator.startStep({
      kind: "tool",
      title: "正在执行工具链",
      content: "按需调用联网搜索和沙盒",
    });

    for (let round = 0; round < AGENT_TOOL_LOOP_MAX_ROUNDS; round += 1) {
      throwIfAborted(req?.signal);
      const instruction = await requestNextInstruction({
        apiKey,
        req,
        userId,
        driverModel,
        prompt: buildToolLoopPrompt({
          goal,
          plan,
          searchContextText,
          attachmentContext: buildAttachmentContext(preparedAttachments),
          preparedAttachments,
          sandboxSession: runtimes.getSandboxSession(),
          toolResults,
          allowSandbox,
          allowWebSearch,
        }),
        thinkingLevel,
        allowSandbox,
        allowWebSearch,
      });

      if (instruction.instruction === "finish") {
        if (instruction.answer) {
          toolResults = [
            ...toolResults,
            {
              id: `tool_result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              title: "工具链已给出收尾建议",
              summary: clipText(instruction.answer, AGENT_TOOL_RESULT_MAX_CHARS),
            },
          ].slice(-AGENT_TOOL_RESULT_MAX_ITEMS);
        }
        break;
      }

      const toolCall = instruction.toolCall;
      const toolView = buildToolView(toolCall);
      const runningTool = coordinator.startTool(toolCall, toolView);

      let result;
      try {
        result = await runtimes.registry.execute(toolCall, { signal: req?.signal });
      } catch (error) {
        result = {
          success: false,
          content: error?.message || "工具执行失败",
          state: { errorMessage: error?.message || "工具执行失败" },
        };
      }

      const toolRun = coordinator.finishTool(toolCall.id, {
        ...toolCall,
        content: typeof result?.content === "string" ? result.content : "",
        citations: Array.isArray(result?.citations) ? result.citations : [],
        state: buildCompactToolState(toolCall, result),
        artifacts: Array.isArray(result?.artifacts) ? result.artifacts : [],
        status: result?.success === false ? "error" : "success",
        summary: buildToolSummary(toolCall, result),
        title: runningTool.title || toolView.title,
        type: "builtin",
      });

      toolResults = [
        ...toolResults,
        {
          id: toolRun.id,
          title: toolRun.title,
          summary: toolRun.summary,
        },
      ].slice(-AGENT_TOOL_RESULT_MAX_ITEMS);

      if (toolCall.identifier === WEB_BROWSING_IDENTIFIER) {
        webBrowsingToolCalls = [
          ...webBrowsingToolCalls,
          {
            identifier: toolCall.identifier,
            apiName: toolCall.apiName,
            arguments: toolCall.arguments,
            content: toolRun.content,
            success: toolRun.status !== "error",
            state: toolRun.state,
          },
        ];
        searchContextText = buildWebBrowsingContextBlock(webBrowsingToolCalls);
      }
    }

    coordinator.completeStep(toolPhaseStep.id, {
      status: "done",
      title: "工具链执行完成",
      content: toolResults.length > 0 ? `共执行 ${toolResults.length} 次工具操作` : "这次任务不需要额外工具操作",
    });
  }

  const writerStep = coordinator.startStep({
    kind: "writer",
    title: "正在整理最终结果",
    content: "准备输出最终答复",
  });
  coordinator.startStream({ channel: "reasoning", label: "推理" });
  coordinator.startStream({ channel: "answer", label: "正文" });

  const finalAnswer = await streamAgentFinalAnswer({
    apiKey,
    req,
    driverModel,
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
    sendEvent: (payload) => {
      if (payload?.type === "text" && typeof payload.content === "string") {
        coordinator.appendStreamChunk({ channel: "answer", content: payload.content });
      } else if (payload?.type === "thought" && typeof payload.content === "string") {
        coordinator.appendStreamChunk({ channel: "reasoning", content: payload.content });
      }
    },
  });

  if (!finalAnswer || !finalAnswer.trim()) {
    throw new Error("Agent 未生成结果");
  }

  coordinator.completeStep(writerStep.id, {
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
    state: coordinator.getState(),
  };
}
