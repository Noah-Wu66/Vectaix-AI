import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildWebSearchContextBlock,
  fetchImageAsBase64,
  getStoredPartsFromMessage,
  injectCurrentTimeSystemReminder,
} from "@/app/api/chat/utils";
import {
  buildWebSearchDecisionPrompts,
  buildWebSearchGuide,
  runWebSearchOrchestration,
} from "@/app/api/chat/webSearchOrchestrator";
import { buildEconomySystemPrompt } from "@/app/lib/economyModels";
import { CLAUDE_OPUS_MODEL } from "@/app/lib/claudeModel";
import { COUNCIL_EXPERTS } from "@/app/lib/councilModel";
import { GEMINI_FLASH_MODEL } from "@/app/lib/geminiModel";
import { SEED_MODEL_ID } from "@/app/lib/seedModel";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ARK_API_KEY = process.env.ARK_API_KEY;
const SEED_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const GEMINI_DECISION_MODEL = GEMINI_FLASH_MODEL;
const GEMINI_DECISION_THINKING_LEVEL = "MINIMAL";
const FORMATTING_GUARD =
  "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";
const EXPERT_MAX_OUTPUT_TOKENS = 4000;
const SEED_MAX_OUTPUT_TOKENS = 8000;
const MAX_RAW_MARKDOWN_CHARS = 20000;
const MAX_FINDING_TEXT_CHARS = 1000;
const HISTORY_USER_SUMMARY_CHARS = 500;
const HISTORY_MODEL_SUMMARY_CHARS = 1200;
const HISTORY_MEMO_MAX_ROUNDS = 6;
const HISTORY_MEMO_MAX_CHARS = 8000;

export const COUNCIL_EXPERT_CONFIGS = COUNCIL_EXPERTS.map((expert) => ({ ...expert }));

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
    if (citations.length >= 20) break;
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

function trimHistoryMemoSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return "";
  let nextSections = sections.slice(-HISTORY_MEMO_MAX_ROUNDS);
  while (nextSections.length > 0) {
    const joined = nextSections.join("\n\n");
    if (joined.length <= HISTORY_MEMO_MAX_CHARS) {
      return joined;
    }
    nextSections = nextSections.slice(1);
  }
  return "";
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
    label: "Seed 汇总",
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

function extractClaudeText(response) {
  return Array.isArray(response?.content)
    ? response.content
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join("")
        .trim()
    : "";
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

async function buildExpertSystemPrompt({ enableWebSearch, searchContextText, includeEconomyPrefix = false }) {
  const basePrompt = includeEconomyPrefix ? buildEconomySystemPrompt() : "";
  const base = await injectCurrentTimeSystemReminder(basePrompt);
  const webSearchGuide = buildWebSearchGuide(enableWebSearch);
  const searchContextSection = searchContextText ? buildWebSearchContextBlock(searchContextText) : "";
  return `${base}\n\n${FORMATTING_GUARD}${webSearchGuide}${searchContextSection}`;
}

async function buildSeedSystemPrompt() {
  const [firstExpertLabel = "专家1", secondExpertLabel = "专家2", thirdExpertLabel = "专家3"] =
    COUNCIL_EXPERT_CONFIGS.map((expert) => expert.label);
  return injectCurrentTimeSystemReminder(`你是 Council 的最终汇总模型 Seed。你会收到用户文字问题、三位专家的完整原始回答，以及每位专家参考过的资料。你的任务是比较三位专家已经写出的正式回答，输出一份最终 Markdown 结论。

重要输入边界：
- 你可能还会收到“历史对话纪要”。它只是此前 Council 已得出的背景结论，不代表这些内容在本轮已经被重新核验。
- 你看到的是用户文字问题，不直接看到用户上传的原始图片或其他原始多模态内容。
- 如果专家回答里涉及图片、图表、截图、文件等内容，你只能依据专家已经写出的描述、结论和引用资料进行汇总，不能假装自己也看过原始材料。
- 判断某位专家的立场时，必须优先以该专家的最终回答内容为准；参考资料只用于补充证据、解释理由，不能拿参考资料反推一个专家没有明确说过的观点。

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
10. “综合分析”只能总结三位专家已经明确写出的内容、差异及其意义，不能替用户重新发明新答案，不能加入专家都没提过的新事实、新结论或新建议。
11. 不要编造不存在的共识或分歧；若信息不足，要明确写成占位说明。
12. 不要泄露任何模型思维链，不要输出裸链接。`);
}

async function buildGeminiDecisionRunner(ai) {
  return async ({ prompt, historyMessages, searchRounds }) => {
    const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages, searchRounds });
    const result = await ai.models.generateContent({
      model: GEMINI_DECISION_MODEL,
      contents: [{ role: "user", parts: [{ text: userText }] }],
      config: {
        systemInstruction: { parts: [{ text: systemText }] },
        maxOutputTokens: 200,
        temperature: 0.1,
        thinkingConfig: {
          thinkingLevel: GEMINI_DECISION_THINKING_LEVEL,
          includeThoughts: false,
        },
      },
    });
    const text = extractGeminiText(result);
    if (!text) {
      throw new Error("联网判断未返回有效内容");
    }
    return text;
  };
}

function buildClaudeDecisionRunner(client, modelId) {
  return async ({ prompt, historyMessages, searchRounds }) => {
    const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages, searchRounds });
    const response = await client.messages.create({
      model: modelId,
      max_tokens: 200,
      system: systemText,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userText }],
        },
      ],
    });
    const text = extractClaudeText(response);
    if (!text) {
      throw new Error("联网判断未返回有效内容");
    }
    return text;
  };
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

async function consumeOpenAIStream(response) {
  if (!response.body) {
    throw new Error("OpenAI 返回了空响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const consumeLine = (line) => {
    if (!line.trim() || line.startsWith(":")) return;
    if (!line.startsWith("data: ")) return;

    const dataStr = line.slice(6);
    if (dataStr === "[DONE]") return;

    try {
      const event = JSON.parse(dataStr);
      if (event.type === "output.text.delta" || event.type === "response.output_text.delta") {
        const delta = typeof event.delta === "string"
          ? event.delta
          : (typeof event.text === "string"
            ? event.text
            : (typeof event?.data?.text === "string" ? event.data.text : ""));
        if (delta) fullText += delta;
        return;
      }

      if (Array.isArray(event?.choices)) {
        const choice = event.choices[0] || null;
        const delta = choice?.delta?.content;
        if (typeof delta === "string") {
          fullText += delta;
          return;
        }
        if (Array.isArray(delta)) {
          fullText += delta
            .map((item) => {
              if (typeof item === "string") return item;
              if (item && typeof item.text === "string") return item.text;
              return "";
            })
            .join("");
        }
      }
    } catch {
      // ignore malformed SSE payloads
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) consumeLine(line);
  }

  buffer += decoder.decode();
  if (buffer) {
    const lines = buffer.split(/\r?\n/);
    for (const line of lines) consumeLine(line);
  }

  return fullText.trim();
}

function buildOpenAIDecisionRunner(modelId, providerConfig) {
  return async ({ prompt, historyMessages, searchRounds }) => {
    const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages, searchRounds });
    const requestBody = {
      model: modelId,
      stream: true,
      max_output_tokens: 200,
      instructions: systemText,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      ],
    };
    const response = await fetch(`${providerConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(extractUpstreamErrorMessage(response.status, errorText));
    }
    const text = await consumeOpenAIStream(response);
    if (!text) {
      throw new Error("联网判断未返回有效内容");
    }
    return text;
  };
}

async function collectSearchContext({
  prompt,
  expert,
  conversationId,
  clientAborted,
  updateStatus,
  providerRoutes,
}) {
  const citations = [];
  const pushCitations = (items) => {
    citations.push(...normalizeCitations(items));
  };
  const sendSearchError = (message) => {
    updateStatus?.({
      status: "error",
      phase: "error",
      message: message || "联网搜索失败",
    });
    throw new Error(message || "联网搜索失败");
  };
  const handleSearchEvent = (event) => {
    if (!isPlainObject(event)) return;
    if (event.type === "search_start") {
      const query = typeof event.query === "string" ? event.query.trim() : "";
      const round = Number.isFinite(event.round) ? event.round : null;
      updateStatus?.({
        status: "running",
        phase: "searching",
        message: query
          ? `${round ? `第${round}轮` : ""}联网检索：${query}`
          : `${round ? `第${round}轮` : ""}联网检索中`,
      });
    }
    if (event.type === "search_result") {
      updateStatus?.({
        status: "running",
        phase: "thinking",
        message: "思考中",
      });
    }
  };

  if (expert.provider === "gemini") {
    assertConfigured(GEMINI_API_KEY, "GEMINI_API_KEY is not set");
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const decisionRunner = await buildGeminiDecisionRunner(ai);
    const { searchContextText } = await runWebSearchOrchestration({
      enableWebSearch: true,
      prompt,
      historyMessages: [],
      decisionRunner,
      sendEvent: handleSearchEvent,
      pushCitations,
      sendSearchError,
      isClientAborted: () => clientAborted(),
      providerLabel: expert.label,
      model: expert.modelId,
      conversationId,
      allowHeuristicFallback: false,
    });
    return { searchContextText, citations: normalizeCitations(citations) };
  }

  if (expert.provider === "claude") {
    const client = new Anthropic({
      apiKey: providerRoutes.opus.apiKey,
      baseURL: providerRoutes.opus.baseUrl,
    });
    const decisionRunner = buildClaudeDecisionRunner(client, CLAUDE_OPUS_MODEL);
    const { searchContextText } = await runWebSearchOrchestration({
      enableWebSearch: true,
      prompt,
      historyMessages: [],
      decisionRunner,
      sendEvent: handleSearchEvent,
      pushCitations,
      sendSearchError,
      isClientAborted: () => clientAborted(),
      providerLabel: expert.label,
      model: expert.modelId,
      conversationId,
      allowHeuristicFallback: false,
    });
    return { searchContextText, citations: normalizeCitations(citations) };
  }

  if (expert.provider === "openai") {
    const decisionRunner = buildOpenAIDecisionRunner(expert.modelId, providerRoutes.openai);
    const { searchContextText } = await runWebSearchOrchestration({
      enableWebSearch: true,
      prompt,
      historyMessages: [],
      decisionRunner,
      sendEvent: handleSearchEvent,
      pushCitations,
      sendSearchError,
      isClientAborted: () => clientAborted(),
      providerLabel: expert.label,
      model: expert.modelId,
      conversationId,
      allowHeuristicFallback: false,
    });
    return { searchContextText, citations: normalizeCitations(citations) };
  }

  throw new Error(`未知专家 provider：${expert.provider}`);
}

async function requestGeminiExpert({ prompt, imagePayloads, expert, searchContextText }) {
  assertConfigured(GEMINI_API_KEY, "GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
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
    includeEconomyPrefix: false,
    searchContextText,
  });
  const result = await ai.models.generateContent({
    model: expert.modelId,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      maxOutputTokens: EXPERT_MAX_OUTPUT_TOKENS,
      temperature: 1,
      thinkingConfig: {
        thinkingLevel: expert.thinkingLevel,
        includeThoughts: false,
      },
    },
  });
  return extractGeminiText(result);
}

async function requestClaudeExpert({ prompt, imagePayloads, expert, searchContextText, providerConfig }) {
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
    includeEconomyPrefix: true,
    searchContextText,
  });
  const response = await client.messages.create({
    model: CLAUDE_OPUS_MODEL,
    max_tokens: EXPERT_MAX_OUTPUT_TOKENS,
    system: [
      {
        type: "text",
        text: systemPrompt,
      },
    ],
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: {
      effort: expert.thinkingLevel,
    },
  });
  return extractClaudeText(response);
}

async function requestOpenAIExpert({ prompt, imagePayloads, expert, searchContextText, providerConfig }) {
  const systemPrompt = await buildExpertSystemPrompt({
    enableWebSearch: true,
    includeEconomyPrefix: true,
    searchContextText,
  });
  const content = [{ type: "input_text", text: prompt }];
  for (const image of imagePayloads) {
    content.push({
      type: "input_image",
      image_url: image.dataUrl,
    });
  }
  const response = await fetch(`${providerConfig.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: expert.modelId,
      stream: true,
      max_output_tokens: EXPERT_MAX_OUTPUT_TOKENS,
      instructions: systemPrompt,
      input: [{ role: "user", content }],
      reasoning: {
        effort: expert.thinkingLevel,
      },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractUpstreamErrorMessage(response.status, errorText));
  }
  return consumeOpenAIStream(response);
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
  conversationId,
  clientAborted,
  updateStatus,
  onDone,
  providerRoutes,
}) {
  try {
    const finalPrompt = buildCouncilTurnPrompt({ historyMemo, prompt });
    const { searchContextText, citations } = await collectSearchContext({
      prompt: finalPrompt,
      expert,
      conversationId,
      clientAborted,
      updateStatus,
      providerRoutes,
    });
    if (clientAborted()) {
      throw new Error("COUNCIL_ABORTED");
    }

    updateStatus?.({
      status: "running",
      phase: "thinking",
      message: "思考中",
    });

    let rawText = "";

    if (expert.provider === "gemini") {
      rawText = await requestGeminiExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText,
      });
    } else if (expert.provider === "claude") {
      rawText = await requestClaudeExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText,
        providerConfig: providerRoutes.opus,
      });
    } else if (expert.provider === "openai") {
      rawText = await requestOpenAIExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText,
        providerConfig: providerRoutes.openai,
      });
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

export async function runSeedCouncilSummary({ historyMemo, prompt, experts, onTextDelta, signal }) {
  assertConfigured(ARK_API_KEY, "ARK_API_KEY 未配置");
  const instructions = await buildSeedSystemPrompt();
  const response = await fetch(`${SEED_API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: SEED_MODEL_ID,
      stream: true,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildSeedPayload({ historyMemo, prompt, experts }),
            },
          ],
        },
      ],
      instructions,
      max_output_tokens: SEED_MAX_OUTPUT_TOKENS,
      temperature: 1,
      top_p: 0.95,
      thinking: { type: "enabled" },
      reasoning: { effort: "medium" },
    }),
    signal,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractUpstreamErrorMessage(response.status, errorText));
  }
  if (!response.body) {
    throw new Error("Seed 未返回有效汇总内容");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  let completedText = "";

  const emitDelta = (value) => {
    const delta = normalizeResponseText(value);
    if (!delta) return;
    streamedText += delta;
    onTextDelta?.(delta);
  };

  const applyCompletedText = (value) => {
    const nextText = typeof value === "string" ? value.trim() : "";
    if (!nextText) return;
    completedText = nextText;
    if (!streamedText) {
      streamedText = nextText;
      onTextDelta?.(nextText);
      return;
    }
    if (nextText.startsWith(streamedText) && nextText.length > streamedText.length) {
      const tail = nextText.slice(streamedText.length);
      streamedText = nextText;
      onTextDelta?.(tail);
    }
  };

  const handleEvent = (event) => {
    const eventType = typeof event?.type === "string" ? event.type : "";
    if (eventType === "response.output_text.delta" || eventType === "output.text.delta") {
      emitDelta(event?.delta ?? event?.text ?? event?.data?.text);
      return;
    }
    if (eventType === "response.completed") {
      applyCompletedText(extractResponsesText(event?.response));
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
      } catch {
        // ignore malformed SSE payloads
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    consumeSseBuffer(false);
  }

  buffer += decoder.decode();
  consumeSseBuffer(true);

  const text = (streamedText || completedText).trim();
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
  const trimmed = trimHistoryMemoSections(sections);
  if (!trimmed) return "";
  return [
    "以下是此前 Council 已完成轮次的对话纪要，请只把它当作背景上下文，不要把它当成已经再次核验的新证据。",
    trimmed,
  ].join("\n\n");
}

export function buildCouncilFinalMessage({
  modelMessageId,
  content,
  experts,
}) {
  return {
    id: modelMessageId,
    role: "model",
    content,
    type: "text",
    parts: [{ text: content }],
    citations: mergeCitations(...experts.map((expert) => expert.citations)),
    councilExperts: experts.map((expert) => ({
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
  };
}
