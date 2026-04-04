import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import {
  fetchImageAsBase64,
  getStoredPartsFromMessage,
  injectCurrentTimeSystemReminder,
} from "@/app/api/chat/utils";
import { buildSeedMessageInput } from "@/app/api/bytedance/bytedanceHelpers";
import {
  buildWebSearchGuide,
} from "@/lib/server/chat/webSearchConfig";
import {
  buildSeedRequestBody,
  extractSeedFunctionCalls,
  extractSeedResponseReasoning,
  extractSeedResponseText,
  normalizeSeedChunkText,
  requestSeedResponses,
} from "@/lib/server/seed/service";
import {
  CLAUDE_OPUS_MODEL,
  DEFAULT_SEED_THINKING_LEVEL,
  getCouncilExpertConfigs,
  getCouncilExpertDisplayLabel,
  SEED_MODEL_ID,
} from "@/lib/shared/models";
import { resolveSeedProviderConfig } from "@/lib/modelRoutes";
import {
  createWebBrowsingRuntime,
  executeWebBrowsingNativeToolCall,
  getAnthropicWebTools,
  getGeminiWebTools,
  getOpenAIWebTools,
  WEB_BROWSING_MAX_ROUNDS,
} from "@/lib/server/webBrowsing/nativeTools";
import { consumeStrictResponsesStream } from "@/lib/server/chat/responsesStream";
import {
  extractOpenAIFunctionCalls,
  extractOpenAIResponseText,
} from "@/app/api/openai/openaiHelpers";

const EXPERT_MAX_OUTPUT_TOKENS = 4000;
const SEED_MAX_OUTPUT_TOKENS = 8000;
const TRIAGE_MAX_OUTPUT_TOKENS = 1200;
const MAX_RAW_MARKDOWN_CHARS = 20000;
const MAX_FINDING_TEXT_CHARS = 1000;
const HISTORY_USER_SUMMARY_CHARS = 500;
const HISTORY_MODEL_SUMMARY_CHARS = 1200;
const COUNCIL_TRIAGE_GREETING_PATTERNS = [
  /^(你好|您好|嗨|哈喽|hi|hello|hey|在吗|早上好|中午好|下午好|晚上好)[\s!,.，。！？~]*$/i,
  /^(谢谢|谢了|多谢|辛苦了|明白了|收到|好的|好的呢|ok|okay)[\s!,.，。！？~]*$/i,
];
const COUNCIL_TRIAGE_COMPLEX_HINT_PATTERN =
  /(代码|编程|程序|脚本|报错|bug|错误|调试|分析|比较|对比|区别|优缺点|推荐|方案|策划|步骤|计划|原因|为什么|如何|怎么做|实现|设计|架构|优化|总结|复盘|写一篇|写个|生成|创作|文案|提示词|工作流|营销|研究|评估|审核|审查|review|debug|code)/i;

export const COUNCIL_EXPERT_CONFIGS = getCouncilExpertConfigs();

function assertConfigured(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, maxChars = MAX_FINDING_TEXT_CHARS) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxChars);
}

function buildAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" && reason ? reason : "COUNCIL_ABORTED");
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw buildAbortError(signal);
  }
}

async function raceWithSignal(task, signal) {
  if (!signal) return task;
  throwIfAborted(signal);

  let onAbort = null;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        onAbort = () => reject(buildAbortError(signal));
        signal.addEventListener?.("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) {
      signal.removeEventListener?.("abort", onAbort);
    }
  }
}

function normalizeCitations(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const citations = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const url = normalizeString(item.url, 2048);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const entry = {
      url,
      title: normalizeString(item.title || url, 200) || url,
    };
    const citedText = normalizeString(item.cited_text, 1000);
    if (citedText) entry.cited_text = citedText;
    citations.push(entry);
  }
  return citations;
}

function mergeCitations(...lists) {
  return normalizeCitations(lists.flat());
}

function extractTextFromStoredParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function hasImageParts(parts) {
  return Array.isArray(parts) && parts.some((part) => typeof part?.inlineData?.url === "string" && part.inlineData.url);
}

function extractCouncilAnalysisSection(content) {
  const text = normalizeString(content, MAX_RAW_MARKDOWN_CHARS);
  if (!text) return "";
  const match = text.match(/(?:^|\n)#{1,6}\s*综合分析\s*\n([\s\S]*?)(?=\n#{1,6}\s+\S|$)/);
  if (!match?.[1]) return "";
  return match[1].trim();
}

function summarizeCouncilUserMessage(message) {
  const parts = getStoredPartsFromMessage(message) || [];
  const text = extractTextFromStoredParts(parts);
  return normalizeString(text, HISTORY_USER_SUMMARY_CHARS);
}

function summarizeCouncilModelMessage(message) {
  const analysis = extractCouncilAnalysisSection(message?.content);
  if (analysis) {
    return normalizeString(analysis, HISTORY_MODEL_SUMMARY_CHARS);
  }
  return normalizeString(message?.content, HISTORY_MODEL_SUMMARY_CHARS);
}

function formatHistoryRoundMemo(roundIndex, userMessage, modelMessage) {
  const userParts = getStoredPartsFromMessage(userMessage) || [];
  const userSummary = summarizeCouncilUserMessage(userMessage) || "（该轮用户未提供可提取的文字问题）";
  const modelSummary = summarizeCouncilModelMessage(modelMessage) || "（该轮未能提取有效结论摘要）";
  const lines = [
    `第 ${roundIndex} 轮`,
    `用户问题：${userSummary}`,
    `Council 结论：${modelSummary}`,
  ];
  if (hasImageParts(userParts)) {
    lines.push("说明：该轮曾包含图片，后续轮次不会自动继续使用原图。");
  }
  return lines.join("\n");
}

function extractCompletedCouncilRounds(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const rounds = [];
  for (let i = 0; i < messages.length; i += 1) {
    const userMessage = messages[i];
    const modelMessage = messages[i + 1];
    if (userMessage?.role !== "user") continue;
    if (modelMessage?.role !== "model") continue;
    rounds.push({ userMessage, modelMessage });
    i += 1;
  }
  return rounds;
}

function buildCouncilTurnPrompt({ historyMemo, prompt }) {
  const sections = [];
  if (historyMemo) {
    sections.push(
      [
        "# 历史对话纪要",
        "以下内容是此前 Council 对话的结论纪要，只能作为背景参考，不能当作已经再次核验过的新证据。",
        "如果纪要里提到之前出现过图片，也不代表你当前仍然看得到那些旧图；只有本轮重新附带的图片才是你现在真正可见的内容。",
        historyMemo,
      ].join("\n")
    );
  }
  sections.push(
    [
      "# 当前用户问题",
      prompt || "（用户仅上传了图片，未提供文字问题）",
      "请优先回答当前这一轮问题，并在需要时结合上面的历史纪要保持上下文连续。",
    ].join("\n")
  );
  return sections.join("\n\n");
}

export function buildCouncilExpertState(expert, patch = {}) {
  return {
    key: expert.key,
    modelId: expert.modelId,
    label: expert.label,
    status: typeof patch.status === "string" ? patch.status : "pending",
    phase: typeof patch.phase === "string" ? patch.phase : "pending",
    message: typeof patch.message === "string" ? patch.message : "",
  };
}

export function buildCouncilSummaryState(patch = {}) {
  return {
    modelId: SEED_MODEL_ID,
    label: "Seed",
    status: typeof patch.status === "string" ? patch.status : "pending",
    phase: typeof patch.phase === "string" ? patch.phase : "pending",
    message: typeof patch.message === "string" ? patch.message : "",
  };
}

function extractGeminiText(result) {
  const parts = Array.isArray(result?.candidates?.[0]?.content?.parts)
    ? result.candidates[0].content.parts
    : [];
  return parts
    .filter((part) => !part?.thought && typeof part?.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

function extractGeminiResponseState(result) {
  const parts = Array.isArray(result?.candidates?.[0]?.content?.parts)
    ? result.candidates[0].content.parts
    : [];
  const functionCalls = [];
  let fullText = "";
  for (const part of parts) {
    if (part?.functionCall) {
      functionCalls.push(part.functionCall);
      continue;
    }
    if (!part?.thought && typeof part?.text === "string") {
      fullText += part.text;
    }
  }
  return { parts, functionCalls, fullText: fullText.trim() };
}

function extractClaudeText(response) {
  return Array.isArray(response?.content)
    ? response.content
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join("")
        .trim()
    : "";
}

function extractClaudeResponseState(response) {
  const content = Array.isArray(response?.content) ? response.content : [];
  const toolUses = [];
  let fullText = "";
  for (const block of content) {
    if (block?.type === "tool_use") {
      toolUses.push(block);
      continue;
    }
    if (block?.type === "text" && typeof block.text === "string") {
      fullText += block.text;
    }
  }
  return { content, toolUses, fullText: fullText.trim() };
}

function normalizeResponseText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.text === "string") return item.text;
        if (item && typeof item.content === "string") return item.content;
        return "";
      })
      .join("");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function isCouncilGreetingPrompt(text) {
  return COUNCIL_TRIAGE_GREETING_PATTERNS.some((pattern) => pattern.test(text));
}

function isVerySimpleCouncilPrompt(text) {
  if (!text) return false;
  if (text.includes("\n")) return false;
  if (text.length > 18) return false;
  if (COUNCIL_TRIAGE_COMPLEX_HINT_PATTERN.test(text)) return false;

  const sentenceParts = text
    .split(/[，,。！？；;、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (sentenceParts.length > 1) return false;

  const latinTokens = text.match(/[A-Za-z0-9]+/g) || [];
  if (latinTokens.length > 4) return false;

  return true;
}

function shouldAllowCouncilDirectAnswer(text) {
  return isCouncilGreetingPrompt(text) || isVerySimpleCouncilPrompt(text);
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((item) => normalizeResponseText(item?.text ?? item))
    .join("")
    .trim();
}

async function loadImagePayloads(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const result = [];
  for (const image of images) {
    const url = typeof image?.url === "string" ? image.url : "";
    if (!url) continue;
    const { base64Data, mimeType: fetchedMimeType } = await fetchImageAsBase64(url);
    const mimeType = normalizeString(image?.mimeType || fetchedMimeType, 128) || fetchedMimeType || "image/jpeg";
    result.push({
      url,
      mimeType,
      base64Data,
      dataUrl: `data:${mimeType};base64,${base64Data}`,
    });
  }
  return result;
}

function buildStoredUserParts(prompt, imagePayloads) {
  const parts = [];
  if (typeof prompt === "string" && prompt.trim()) {
    parts.push({ text: prompt });
  }
  for (const image of imagePayloads) {
    parts.push({
      inlineData: {
        url: image.url,
        mimeType: image.mimeType,
      },
    });
  }
  return parts;
}

async function buildExpertSystemPrompt({ enableWebSearch, searchContextText }) {
  const base = await injectCurrentTimeSystemReminder("");
  const webSearchGuide = buildWebSearchGuide(enableWebSearch);
  const searchContextSection = searchContextText || "";
  return `${base}${webSearchGuide}${searchContextSection}`;
}

async function buildSeedSystemPrompt() {
  const [firstExpertLabel = "专家1", secondExpertLabel = "专家2", thirdExpertLabel = "专家3"] =
    COUNCIL_EXPERT_CONFIGS.map((expert) => getCouncilExpertDisplayLabel(expert));
  return injectCurrentTimeSystemReminder(`你是 Council 的最终汇总模型 Seed。你会收到用户文字问题、三位专家的完整原始回答，以及每位专家参考过的资料。你的任务不是单纯对比三位专家，而是基于三位专家已经给出的内容，整合观点后直接回答用户问题，并输出一份最终 Markdown 结论。

重要输入边界：
- 你可能还会收到“历史对话纪要”。它只是此前 Council 已得出的背景结论，不代表这些内容在本轮已经被重新核验。
- 你看到的是用户文字问题，不直接看到用户上传的原始图片或其他原始多模态内容。
- 如果专家回答里涉及图片、图表、截图、文件等内容，你只能依据专家已经写出的描述、结论和引用资料进行汇总，不能假装自己也看过原始材料。
- 判断某位专家的立场时，必须优先以该专家的最终回答内容为准；参考资料只用于补充证据、解释理由，不能拿参考资料反推一个专家没有明确说过的观点。
- 你可以整合三位专家的建议，形成一份面向用户的最终答案；但这个最终答案必须建立在专家已经明确说过的观点、理由、证据之上，不能凭空增加新事实。

必须严格遵守：
1. 必须严格包含且只包含以下四个一级标题：
- 模型共识
- 模型分歧
- 独特发现
- 综合分析
2. 第 1、2、3 节必须使用 Markdown 表格。
3. 第 1 节表头固定为：
发现 | ${firstExpertLabel} | ${secondExpertLabel} | ${thirdExpertLabel} | 证据
4. 第 2 节表头固定为：
主题 | ${firstExpertLabel} | ${secondExpertLabel} | ${thirdExpertLabel} | 分歧原因
5. 第 3 节表头固定为：
模型 | 独特发现 | 重要性
6. 若某节没有内容，仍保留标题和表头，并补一行占位说明。
7. 第 1 节（模型共识）中，只有当某位专家明确表达过该观点时，才用“✓”；没有明确表达就留空。
8. 第 2 节（模型分歧）中禁止使用“✓”，必须直接写出各模型对该分歧主题的简短立场或结论。
9. “证据”和“分歧原因”只能基于专家回答或提供的资料来写，不要脑补。
10. “综合分析”不是做模型对比表总结，而是给用户的最终答复区。开头必须先直接回答用户当前问题，明确给出结论、建议、方案、判断或下一步做法。
11. “综合分析”后续可以解释你为什么这样回答：要把三位专家的共识、分歧、独特发现整合起来，告诉用户哪些意见最值得采纳、哪些情况需要区分条件。
12. 当三位专家意见不一致时，你要替用户做整合判断：可以给出更稳妥的主结论，也可以按条件分情况回答，但必须明确告诉用户最终该怎么理解、怎么做，而不是把分歧丢给用户自己消化。
13. “综合分析”可以整合、提炼、重组专家建议，但不能加入任何专家都没提过的新事实、新证据；如果信息不足，可以明确说明“基于现有专家意见，更稳妥的结论是……”“目前只能先做到……”
14. 不要编造不存在的共识或分歧；若信息不足，要明确写成占位说明。
15. 不要泄露任何模型思维链，不要输出裸链接。
16. 所有正文和表格里的模型名统一只写短名：${firstExpertLabel}、${secondExpertLabel}、${thirdExpertLabel}，不要写完整版本号。`);
}

function extractUpstreamErrorMessage(status, rawText) {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) return `上游请求失败（${status}）`;
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message || parsed?.message || parsed?.error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // ignore
  }
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

function createGeminiClient(providerConfig) {
  if (!providerConfig?.apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  if (providerConfig?.baseUrl) {
    return new GoogleGenAI({
      apiKey: providerConfig.apiKey,
      httpOptions: {
        baseUrl: providerConfig.baseUrl,
      },
    });
  }
  return new GoogleGenAI({ apiKey: providerConfig.apiKey });
}

function getGeminiModelId(expertModelId) {
  return expertModelId;
}

async function requestGeminiExpert({ prompt, imagePayloads, expert, searchContextText, providerConfig, signal }) {
  const ai = createGeminiClient(providerConfig);
  const modelId = getGeminiModelId(expert.modelId);
  const parts = [{ text: prompt }];
  for (const image of imagePayloads) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64Data,
      },
    });
  }
  const systemPrompt = await buildExpertSystemPrompt({
    enableWebSearch: true,
    searchContextText,
  });
  const citations = [];
  const runtime = createWebBrowsingRuntime();
  const workingContents = [{ role: "user", parts }];

  for (let round = 0; round < WEB_BROWSING_MAX_ROUNDS; round += 1) {
    const result = await raceWithSignal(ai.models.generateContent({
      model: modelId,
      contents: workingContents,
      config: {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        maxOutputTokens: EXPERT_MAX_OUTPUT_TOKENS,
        temperature: 1,
        thinkingConfig: {
          thinkingLevel: expert.thinkingLevel,
          includeThoughts: false,
        },
        tools: getGeminiWebTools(),
      },
    }), signal);
    const state = extractGeminiResponseState(result);
    if (state.functionCalls.length === 0) {
      return { rawText: state.fullText || extractGeminiText(result), citations: normalizeCitations(citations) };
    }
    workingContents.push({ role: "model", parts: state.parts });
    const functionResponseParts = [];
    for (const functionCall of state.functionCalls) {
      const toolExecution = await executeWebBrowsingNativeToolCall({
        apiName: functionCall?.name,
        argumentsInput: functionCall?.args,
        runtime,
        pushCitations: (items) => citations.push(...items),
        round: round + 1,
        signal,
      });
      functionResponseParts.push({
        functionResponse: {
          name: functionCall.name,
          response: { result: toolExecution.outputText },
          ...(typeof functionCall?.id === "string" && functionCall.id ? { id: functionCall.id } : {}),
        },
      });
    }
    workingContents.push({ role: "user", parts: functionResponseParts });
  }
  throw new Error(`${expert.label} 工具循环未返回最终答案`);
}

async function requestClaudeExpert({ prompt, imagePayloads, expert, searchContextText, providerConfig, signal }) {
  const client = new Anthropic({
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseUrl,
  });
  const content = [{ type: "text", text: prompt }];
  for (const image of imagePayloads) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64Data,
      },
    });
  }
  const systemPrompt = await buildExpertSystemPrompt({
    enableWebSearch: true,
    searchContextText,
  });
  const citations = [];
  const runtime = createWebBrowsingRuntime();
  const workingMessages = [{ role: "user", content }];

  for (let round = 0; round < WEB_BROWSING_MAX_ROUNDS; round += 1) {
    const response = await raceWithSignal(client.messages.create({
      model: CLAUDE_OPUS_MODEL,
      max_tokens: EXPERT_MAX_OUTPUT_TOKENS,
      system: [{ type: "text", text: systemPrompt }],
      messages: workingMessages,
      tools: getAnthropicWebTools(),
      thinking: { type: "adaptive" },
      output_config: { effort: expert.thinkingLevel },
    }), signal);
    const state = extractClaudeResponseState(response);
    if (state.toolUses.length === 0 || response?.stop_reason !== "tool_use") {
      return { rawText: state.fullText || extractClaudeText(response), citations: normalizeCitations(citations) };
    }
    workingMessages.push({ role: "assistant", content: response.content });
    const toolResultBlocks = [];
    for (const toolUse of state.toolUses) {
      const toolExecution = await executeWebBrowsingNativeToolCall({
        apiName: toolUse?.name,
        argumentsInput: toolUse?.input,
        runtime,
        pushCitations: (items) => citations.push(...items),
        round: round + 1,
        signal,
      });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: toolExecution.outputText,
      });
    }
    workingMessages.push({ role: "user", content: toolResultBlocks });
  }
  throw new Error(`${expert.label} 工具循环未返回最终答案`);
}

async function requestOpenAIExpert({ prompt, imagePayloads, expert, searchContextText, providerConfig, signal }) {
  const systemPrompt = await buildExpertSystemPrompt({
    enableWebSearch: true,
    searchContextText,
  });
  const content = [{ type: "input_text", text: prompt }];
  for (const image of imagePayloads) {
    content.push({
      type: "input_image",
      image_url: image.dataUrl,
    });
  }
  const citations = [];
  const runtime = createWebBrowsingRuntime();
  let nextInput = [{ role: "user", content }];
  let previousResponseId = "";

  for (let round = 0; round < WEB_BROWSING_MAX_ROUNDS; round += 1) {
    const response = await fetch(`${providerConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: expert.modelId,
        stream: false,
        store: true,
        max_output_tokens: EXPERT_MAX_OUTPUT_TOKENS,
        instructions: systemPrompt,
        input: nextInput,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        tools: getOpenAIWebTools(),
        reasoning: { effort: expert.thinkingLevel },
      }),
      signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(extractUpstreamErrorMessage(response.status, errorText));
    }
    const payload = await response.json();
    const functionCalls = extractOpenAIFunctionCalls(payload);
    if (functionCalls.length === 0) {
      return {
        rawText: extractOpenAIResponseText(payload),
        citations: normalizeCitations(citations),
      };
    }
    previousResponseId = typeof payload?.id === "string" ? payload.id : previousResponseId;
    nextInput = [];
    for (const functionCall of functionCalls) {
      const toolExecution = await executeWebBrowsingNativeToolCall({
        apiName: functionCall.name,
        argumentsInput: functionCall.arguments,
        runtime,
        pushCitations: (items) => citations.push(...items),
        round: round + 1,
        signal,
      });
      nextInput.push({
        type: "function_call_output",
        call_id: functionCall.call_id,
        output: toolExecution.outputText,
      });
    }
  }
  throw new Error(`${expert.label} 工具循环未返回最终答案`);
}

function normalizeExpertOutput(rawText, expert, citations) {
  const rawMarkdown = normalizeString(rawText, MAX_RAW_MARKDOWN_CHARS);
  if (!rawMarkdown) {
    throw new Error(`${expert.label} 未返回有效内容`);
  }
  return {
    modelId: expert.modelId,
    label: expert.label,
    rawMarkdown,
    citations: normalizeCitations(citations),
  };
}

export async function runCouncilExpert({
  prompt,
  historyMemo,
  imagePayloads,
  expert,
  userId,
  conversationId,
  clientAborted,
  updateStatus,
  onDone,
  providerRoutes,
  history,
  signal,
}) {
  try {
    const finalPrompt = buildCouncilTurnPrompt({ historyMemo, prompt });
    throwIfAborted(signal);
    if (clientAborted()) throw new Error("COUNCIL_ABORTED");

    updateStatus?.({
      status: "running",
      phase: "thinking",
      message: "思考中",
    });

    let rawText = "";
    let citations = [];

    if (expert.provider === "gemini") {
      const result = await requestGeminiExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText: "",
        providerConfig: providerRoutes.gemini,
        signal,
      });
      rawText = result.rawText;
      citations = result.citations;
    } else if (expert.provider === "claude") {
      const result = await requestClaudeExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText: "",
        providerConfig: providerRoutes.opus,
        signal,
      });
      rawText = result.rawText;
      citations = result.citations;
    } else if (expert.provider === "openai") {
      const result = await requestOpenAIExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText: "",
        providerConfig: providerRoutes.openai,
        signal,
      });
      rawText = result.rawText;
      citations = result.citations;
    } else {
      throw new Error(`未知专家 provider：${expert.provider}`);
    }

    const normalized = normalizeExpertOutput(rawText, expert, citations);
    updateStatus?.({
      status: "done",
      phase: "done",
      message: "已完成回答",
    });
    onDone?.(normalized);
    return normalized;
  } catch (error) {
    if (error?.message !== "COUNCIL_ABORTED") {
      updateStatus?.({
        status: "error",
        phase: "error",
        message: error?.message || "执行失败",
      });
    }
    throw error;
  }
}

function buildSeedPayload({ historyMemo, prompt, experts }) {
  const sections = [
    ...(historyMemo ? ["# 历史对话纪要", historyMemo] : []),
    `# 用户问题\n${prompt}`,
    "# 专家原始回答",
  ];

  for (const expert of experts) {
    const citations = normalizeCitations(expert.citations);
    const citationText = citations.length > 0
      ? citations.map((item, index) => {
          const lines = [`${index + 1}. ${item.title}`, `链接：${item.url}`];
          if (item.cited_text) lines.push(`摘录：${item.cited_text}`);
          return lines.join("\n");
        }).join("\n")
      : "无";

    sections.push(
      `## ${expert.label}`,
      expert.rawMarkdown,
      `### ${expert.label} 参考资料`,
      citationText
    );
  }

  return sections.join("\n\n");
}

export async function runSeedTriage({ prompt, hasImages, signal }) {
  if (hasImages) return { needCouncil: true };
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) return { needCouncil: true };
  if (!shouldAllowCouncilDirectAnswer(trimmed)) {
    return { needCouncil: true };
  }

  const seedConfig = resolveSeedProviderConfig();
  throwIfAborted(signal);

  try {
    const response = await requestSeedResponses({
      apiKey: seedConfig.apiKey,
      baseUrl: seedConfig.baseUrl,
      requestBody: buildSeedRequestBody({
        model: SEED_MODEL_ID,
        stream: false,
        maxTokens: TRIAGE_MAX_OUTPUT_TOKENS,
        thinkingLevel: "minimal",
        temperature: 0.3,
        instructions: `你是 Council 路由判断器。Council 会并行调用三位专家模型讨论。你的判断必须非常保守，只有在用户消息明显属于“打招呼 / 非常简单的一句话小问题”时，才允许跳过专家。

只有以下两类，才可以不调用 Council（直接回答）：
- 打招呼、问候、感谢、确认、寒暄，例如“你好”“在吗”“谢谢”“好的”
- 非常简单的一句话小问题，并且满足：很短、没有分析要求、没有创作要求、没有专业判断要求、没有多步骤要求

下面这些一律必须调用 Council（返回 needCouncil: true）：
- 任何分析、比较、解释、总结、推荐、评估、研究
- 任何编程、调试、代码、脚本、报错、审查
- 任何写作、创作、文案、策划、方案、提示词
- 任何带明显专业判断的问题
- 任何稍微复杂、稍微长一点、稍微不确定的问题
- 只要你有一丝犹豫，就必须调用 Council

你要默认“调用 Council”，而不是默认“跳过专家”。

你必须返回 JSON，不要输出其他内容。
如果不需要 Council，同时给出直接回答：
{"needCouncil":false,"directAnswer":"你的回答内容"}
如果需要 Council：
{"needCouncil":true}`,
        input: [
          buildSeedMessageInput({
            role: "user",
            content: [{ type: "input_text", text: trimmed }],
          }),
        ],
      }),
      req: { signal },
    });

    if (!response.ok) return { needCouncil: true };

    const data = await response.json();
    const text = extractSeedResponseText(data);
    if (!text) return { needCouncil: true };

    // 尝试从回复中提取 JSON（兼容模型在 JSON 前后加了额外文字的情况）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { needCouncil: true };

    const parsed = JSON.parse(jsonMatch[0]);
    if (
      parsed.needCouncil === false
      && shouldAllowCouncilDirectAnswer(trimmed)
      && typeof parsed.directAnswer === "string"
      && parsed.directAnswer.trim()
    ) {
      return { needCouncil: false, directAnswer: parsed.directAnswer.trim() };
    }
    return { needCouncil: true };
  } catch (error) {
    if (signal?.aborted) {
      throw buildAbortError(signal);
    }
    return { needCouncil: true };
  }
}

export async function runSeedCouncilSummary({ historyMemo, prompt, experts, onTextDelta, signal }) {
  const seedConfig = resolveSeedProviderConfig();
  const instructions = await buildSeedSystemPrompt();
  const response = await requestSeedResponses({
    apiKey: seedConfig.apiKey,
    baseUrl: seedConfig.baseUrl,
    requestBody: buildSeedRequestBody({
      model: SEED_MODEL_ID,
      stream: true,
      input: [
        buildSeedMessageInput({
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildSeedPayload({ historyMemo, prompt, experts }),
            },
          ],
        }),
      ],
      instructions,
      maxTokens: SEED_MAX_OUTPUT_TOKENS,
      thinkingLevel: DEFAULT_SEED_THINKING_LEVEL,
      temperature: 1,
    }),
    req: { signal },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractUpstreamErrorMessage(response.status, errorText));
  }
  const finalPayload = await consumeStrictResponsesStream({
    response,
    signal,
    normalizeText: normalizeSeedChunkText,
    onTextDelta,
    emptyBodyMessage: "Seed 未返回有效汇总内容",
    missingCompletedMessage: "Seed 上游缺少 response.completed 事件",
  });

  const text = extractSeedResponseText(finalPayload).trim();
  if (!text) {
    throw new Error("Seed 未返回有效汇总内容");
  }
  return text;
}

export async function buildCouncilUserInput({ prompt, images }) {
  const imagePayloads = await loadImagePayloads(images);
  return {
    prompt,
    imagePayloads,
    userParts: buildStoredUserParts(prompt, imagePayloads),
  };
}

export async function buildCouncilUserInputFromMessage(message) {
  const parts = getStoredPartsFromMessage(message) || [];
  if (parts.some((part) => part?.fileData?.url)) {
    throw new Error("Council 当前只支持文字和图片输入");
  }
  const prompt = extractTextFromStoredParts(parts);
  const images = parts
    .filter((part) => typeof part?.inlineData?.url === "string" && part.inlineData.url)
    .map((part) => ({
      url: part.inlineData.url,
      mimeType: part.inlineData.mimeType,
    }));
  const imagePayloads = await loadImagePayloads(images);
  return {
    prompt,
    imagePayloads,
    userParts: buildStoredUserParts(prompt, imagePayloads),
  };
}

export function buildCouncilHistoryMemo(messages) {
  const rounds = extractCompletedCouncilRounds(messages);
  if (rounds.length === 0) return "";
  const sections = rounds.map(({ userMessage, modelMessage }, index) =>
    formatHistoryRoundMemo(index + 1, userMessage, modelMessage)
  );
  return [
    "以下是此前 Council 已完成轮次的对话纪要，请只把它当作背景上下文，不要把它当成已经再次核验的新证据。",
    sections.join("\n\n"),
  ].join("\n\n");
}

export function buildCouncilFinalMessage({
  modelMessageId,
  content,
  experts,
}) {
  const safeExperts = Array.isArray(experts) ? experts : [];
  return {
    id: modelMessageId,
    role: "model",
    content,
    type: "text",
    parts: [{ text: content }],
    citations: safeExperts.length > 0 ? mergeCitations(...safeExperts.map((expert) => expert.citations)) : [],
    councilExperts: safeExperts.map((expert) => ({
      modelId: expert.modelId,
      label: expert.label,
      content: expert.rawMarkdown,
      citations: expert.citations,
    })),
  };
}

export function createCouncilStreamHelpers(controller) {
  const encoder = new TextEncoder();
  return {
    sendEvent(payload) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    },
    sendText(content) {
      if (!content) return;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content })}\n\n`));
    },
    sendCouncilExpertStates(experts) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "council_expert_states", experts })}\n\n`)
      );
    },
    sendCouncilExpertState(expert) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "council_expert_state", expert })}\n\n`)
      );
    },
    sendCouncilSummaryState(summary) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "council_summary_state", summary })}\n\n`)
      );
    },
    sendCouncilExperts(experts) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: "council_experts",
          experts: experts.map((expert) => ({
            modelId: expert.modelId,
            label: expert.label,
            content: expert.rawMarkdown,
            citations: expert.citations,
          })),
        })}\n\n`)
      );
    },
    sendCouncilExpertResult(expert) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: "council_expert_result",
          expert: {
            modelId: expert.modelId,
            label: expert.label,
            content: expert.rawMarkdown,
            citations: expert.citations,
          },
        })}\n\n`)
      );
    },
    sendCitations(citations) {
      if (!Array.isArray(citations) || citations.length === 0) return;
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "citations", citations })}\n\n`)
      );
    },
    sendDone() {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
    sendCouncilTriage(payload) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "council_triage", ...payload })}\n\n`)
      );
    },
  };
}
