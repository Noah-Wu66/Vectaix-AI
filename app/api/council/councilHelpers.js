import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildWebSearchContextBlock,
  fetchImageAsBase64,
  injectCurrentTimeSystemReminder,
} from "@/app/api/chat/utils";
import {
  buildWebSearchDecisionPrompts,
  buildWebSearchGuide,
  runWebSearchOrchestration,
} from "@/app/api/chat/webSearchOrchestrator";
import { buildEconomySystemPrompt } from "@/app/lib/economyModels";
import { OPENAI_PRIMARY_MODEL } from "@/app/lib/openaiModel";
import { SEED_MODEL_ID } from "@/app/lib/seedModel";

const RIGHT_CODES_OPENAI_BASE_URL = process.env.RIGHT_CODES_OPENAI_BASE_URL || "https://www.right.codes/codex/v1";
const RIGHT_CODES_API_KEY = process.env.RIGHT_CODES_API_KEY;
const AIGOCODE_CLAUDE_BASE_URL = "https://api.aigocode.com";
const AIGOCODE_API_KEY = process.env.AIGOCODE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ARK_API_KEY = process.env.ARK_API_KEY;
const SEED_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const GEMINI_DECISION_MODEL = "gemini-3-flash-preview";
const GEMINI_DECISION_THINKING_LEVEL = "MINIMAL";
const FORMATTING_GUARD =
  "Output formatting rules: Do not use Markdown horizontal rules or standalone lines of '---'. Do not insert multiple consecutive blank lines; use at most one blank line between paragraphs.";
const EXPERT_MAX_OUTPUT_TOKENS = 4000;
const SEED_MAX_OUTPUT_TOKENS = 8000;
const MAX_RAW_MARKDOWN_CHARS = 20000;
const MAX_FINDING_TEXT_CHARS = 1000;

export const COUNCIL_EXPERT_CONFIGS = [
  {
    key: "gpt",
    modelId: OPENAI_PRIMARY_MODEL,
    label: "GPT-5.4 Thinking",
    provider: "openai",
    thinkingLevel: "xhigh",
  },
  {
    key: "opus",
    modelId: "claude-opus-4-6-20260205",
    label: "Claude Opus 4.6 Thinking",
    provider: "claude",
    thinkingLevel: "max",
  },
  {
    key: "pro",
    modelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Thinking",
    provider: "gemini",
    thinkingLevel: "HIGH",
  },
];

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

function chunkText(text, chunkSize = 180) {
  if (typeof text !== "string" || !text) return [];
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + chunkSize));
    index += chunkSize;
  }
  return chunks;
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

function buildExpertMarkdownPrompt(label) {
  return `你现在是 Council 专家团中的 ${label}。请独立分析用户问题，给出你自己的判断，不要迎合其他模型，也不要假设其他模型会怎么说。

请直接输出给用户看的最终 Markdown 回答，不要输出 JSON，不要输出解释你在做什么，也不要用代码块包住整个回答。

要求：
1. 回答必须能单独成立，先给出明确结论，再写依据、风险、不确定性。
2. 如果信息有时效性，要明确时间条件；如果信息不足，要直接说明不足点。
3. 不要输出思维链，不要编造资料，不要假装看过不存在的来源。
4. 不要在正文里附加裸链接或裸域名括号。`;
}

async function buildExpertSystemPrompt({ label, enableWebSearch, searchContextText }) {
  const base = await injectCurrentTimeSystemReminder(buildEconomySystemPrompt(buildExpertMarkdownPrompt(label)));
  const webSearchGuide = buildWebSearchGuide(enableWebSearch);
  const searchContextSection = searchContextText ? buildWebSearchContextBlock(searchContextText) : "";
  return `${base}\n\n${FORMATTING_GUARD}${webSearchGuide}${searchContextSection}`;
}

async function buildSeedSystemPrompt() {
  return injectCurrentTimeSystemReminder(`你是 Council 的最终汇总模型 Seed。你会收到用户问题、三位专家的完整原始回答，以及每位专家参考过的资料。你的任务是比较三位专家已经写出的正式回答，输出一份最终 Markdown 结论。

必须严格遵守：
1. 只能输出 Markdown，不要输出 JSON，不要输出代码块。
2. 必须严格包含且只包含以下四个一级标题：
1. 模型共识
2. 模型分歧
3. 独特发现
4. 综合分析
3. 第 1、2、3 节必须使用 Markdown 表格。
4. 第 1 节表头固定为：
Finding | GPT-5.4 Thinking | Claude Opus 4.6 Thinking | Gemini 3.1 Pro Thinking | Evidence
5. 第 2 节表头固定为：
Topic | GPT-5.4 Thinking | Claude Opus 4.6 Thinking | Gemini 3.1 Pro Thinking | Why They Differ
6. 第 3 节表头固定为：
Model | Unique Finding | Why It Matters
7. 若某节没有内容，仍保留标题和表头，并补一行占位说明。
8. 在第 1、2 节中，只有当某位专家明确表达过该观点时，才用“✓”；没有明确表达就留空。
9. Evidence 和 Why They Differ 只能基于专家回答或提供的资料来写，不要脑补。
10. 不要编造不存在的共识或分歧；若信息不足，要明确写成占位说明。
11. 不要泄露任何模型思维链，不要输出裸链接。`);
}

async function buildGeminiDecisionRunner(ai) {
  return async ({ prompt, historyMessages }) => {
    const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages });
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
  return async ({ prompt, historyMessages }) => {
    const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages });
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

function buildOpenAIDecisionRunner(modelId) {
  assertConfigured(RIGHT_CODES_API_KEY, "RIGHT_CODES_API_KEY is not set");
  return async ({ prompt, historyMessages }) => {
    const { systemText, userText } = await buildWebSearchDecisionPrompts({ prompt, historyMessages });
    const requestBody = {
      model: modelId,
      stream: false,
      max_output_tokens: 200,
      instructions: systemText,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      ],
    };
    const response = await fetch(`${RIGHT_CODES_OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RIGHT_CODES_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(extractUpstreamErrorMessage(response.status, errorText));
    }
    const payload = await response.json();
    const text = extractResponsesText(payload);
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
      updateStatus?.({
        status: "running",
        phase: "searching",
        message: query ? `联网检索：${query}` : "联网检索中",
      });
    }
    if (event.type === "search_result") {
      updateStatus?.({
        status: "running",
        phase: "thinking",
        message: "已完成联网检索，开始生成回答",
      });
    }
  };

  updateStatus?.({
    status: "running",
    phase: "decision",
    message: "判断是否需要联网",
  });

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
    assertConfigured(AIGOCODE_API_KEY, "AIGOCODE_API_KEY is not set");
    const client = new Anthropic({
      apiKey: AIGOCODE_API_KEY,
      baseURL: AIGOCODE_CLAUDE_BASE_URL,
    });
    const decisionRunner = buildClaudeDecisionRunner(client, "claude-opus-4-6");
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
    const decisionRunner = buildOpenAIDecisionRunner(expert.modelId);
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
    label: expert.label,
    enableWebSearch: true,
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

async function requestClaudeExpert({ prompt, imagePayloads, expert, searchContextText }) {
  assertConfigured(AIGOCODE_API_KEY, "AIGOCODE_API_KEY is not set");
  const client = new Anthropic({
    apiKey: AIGOCODE_API_KEY,
    baseURL: AIGOCODE_CLAUDE_BASE_URL,
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
    label: expert.label,
    enableWebSearch: true,
    searchContextText,
  });
  const response = await client.messages.create({
    model: "claude-opus-4-6",
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

async function requestOpenAIExpert({ prompt, imagePayloads, expert, searchContextText }) {
  assertConfigured(RIGHT_CODES_API_KEY, "RIGHT_CODES_API_KEY is not set");
  const systemPrompt = await buildExpertSystemPrompt({
    label: expert.label,
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
  const response = await fetch(`${RIGHT_CODES_OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RIGHT_CODES_API_KEY}`,
    },
    body: JSON.stringify({
      model: expert.modelId,
      stream: false,
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
  const payload = await response.json();
  return extractResponsesText(payload);
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
  imagePayloads,
  expert,
  conversationId,
  clientAborted,
  updateStatus,
}) {
  updateStatus?.({
    status: "running",
    phase: "starting",
    message: "开始分析问题",
  });

  try {
    const { searchContextText, citations } = await collectSearchContext({
      prompt,
      expert,
      conversationId,
      clientAborted,
      updateStatus,
    });
    if (clientAborted()) {
      throw new Error("COUNCIL_ABORTED");
    }

    updateStatus?.({
      status: "running",
      phase: "thinking",
      message: searchContextText ? "整理资料并生成回答" : "直接生成回答",
    });

    const finalPrompt = `${prompt}\n\n请基于上面的用户问题完成任务。`;
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
      });
    } else if (expert.provider === "openai") {
      rawText = await requestOpenAIExpert({
        prompt: finalPrompt,
        imagePayloads,
        expert: { ...expert, label: expert.label, thinkingLevel: expert.thinkingLevel },
        searchContextText,
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

function buildSeedPayload({ prompt, experts }) {
  const sections = [
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

export async function runSeedCouncilSummary({ prompt, experts }) {
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
      stream: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildSeedPayload({ prompt, experts }),
            },
          ],
        },
      ],
      instructions,
      max_output_tokens: SEED_MAX_OUTPUT_TOKENS,
      temperature: 1,
      top_p: 0.95,
      thinking: { type: "enabled" },
      reasoning: { effort: "high" },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(extractUpstreamErrorMessage(response.status, errorText));
  }
  const payload = await response.json();
  const text = extractResponsesText(payload);
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

export function streamCouncilSummary(streamHelpers, summary) {
  for (const chunk of chunkText(summary)) {
    streamHelpers.sendText(chunk);
  }
}
