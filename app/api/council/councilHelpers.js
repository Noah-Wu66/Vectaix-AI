import {
  fetchImageAsBase64,
  getStoredPartsFromMessage,
  injectCurrentTimeSystemReminder,
} from "@/app/api/chat/utils";
import {
  COUNCIL_EXPERTS,
  COUNCIL_SYNTHESIS_MODEL,
  getCouncilExpertDisplayLabel,
} from "@/lib/shared/models";
import {
  getChatCompletionOutputText,
  requestZenMuxChatCompletionResponse,
} from "@/lib/server/zenmux/openai";

const EXPERT_MAX_OUTPUT_TOKENS = 64000;
const COUNCIL_ANALYSIS_MAX_OUTPUT_TOKENS = 32768;
const COUNCIL_RESULT_MAX_OUTPUT_TOKENS = 32768;
const TRIAGE_MAX_OUTPUT_TOKENS = 1200;
const MAX_RAW_MARKDOWN_CHARS = 20000;
const MAX_FINDING_TEXT_CHARS = 1000;
const HISTORY_USER_SUMMARY_CHARS = 500;
const HISTORY_MODEL_SUMMARY_CHARS = 1200;
const COUNCIL_ANALYSIS_GROUP_KEYS = ["agreement", "keyDifferences", "partialCoverage", "uniqueInsights", "blindSpots"];
const COUNCIL_ANALYSIS_MODEL_NAMES = new Set(["GPT", "Claude", "Gemini"]);
const COUNCIL_ANALYSIS_SECTION_LABELS = {
  agreement: "共识点",
  keyDifferences: "关键分歧",
  partialCoverage: "覆盖不全",
  uniqueInsights: "独特洞察",
  blindSpots: "盲点",
};
const COUNCIL_TRIAGE_GREETING_PATTERNS = [
  /^(你好|您好|嗨|哈喽|hi|hello|hey|在吗|早上好|中午好|下午好|晚上好)[\s!,.，。！？~]*$/i,
  /^(谢谢|谢了|多谢|辛苦了|明白了|收到|好的|好的呢|ok|okay)[\s!,.，。！？~]*$/i,
];
const COUNCIL_TRIAGE_COMPLEX_HINT_PATTERN =
  /(代码|编程|程序|脚本|报错|bug|错误|调试|分析|比较|对比|区别|优缺点|推荐|方案|策划|步骤|计划|原因|为什么|如何|怎么做|实现|设计|架构|优化|总结|复盘|写一篇|写个|生成|创作|文案|提示词|工作流|营销|研究|评估|审核|审查|review|debug|code)/i;

const COUNCIL_EXPERT_CONFIGS = COUNCIL_EXPERTS;

export { COUNCIL_EXPERT_CONFIGS };

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

export function buildCouncilAnalysisState(patch = {}) {
  return {
    modelId: COUNCIL_SYNTHESIS_MODEL,
    label: "分析",
    status: typeof patch.status === "string" ? patch.status : "pending",
    phase: typeof patch.phase === "string" ? patch.phase : "pending",
    message: typeof patch.message === "string" ? patch.message : "",
  };
}

export function buildCouncilResultState(patch = {}) {
  return {
    modelId: COUNCIL_SYNTHESIS_MODEL,
    label: "Doubao",
    status: typeof patch.status === "string" ? patch.status : "pending",
    phase: typeof patch.phase === "string" ? patch.phase : "pending",
    message: typeof patch.message === "string" ? patch.message : "",
  };
}

function normalizeCouncilAnalysisModels(models) {
  if (!Array.isArray(models)) return [];
  return Array.from(new Set(
    models
      .filter((model) => typeof model === "string")
      .map((model) => model.trim())
      .map((model) => {
        if (/gpt|chatgpt/i.test(model)) return "GPT";
        if (/claude/i.test(model)) return "Claude";
        if (/gemini/i.test(model)) return "Gemini";
        return model;
      })
      .filter((model) => COUNCIL_ANALYSIS_MODEL_NAMES.has(model))
  ));
}

function normalizeCouncilAnalysisPayload(value) {
  if (!isPlainObject(value)) {
    throw new Error("Council 分析结果不是有效 JSON 对象");
  }

  const result = {};
  for (const key of COUNCIL_ANALYSIS_GROUP_KEYS) {
    const rawItems = Array.isArray(value[key]) ? value[key] : [];
    result[key] = rawItems
      .filter((item) => isPlainObject(item))
      .map((item) => ({
        text: normalizeString(item.text, 2000),
        models: normalizeCouncilAnalysisModels(item.models),
      }))
      .filter((item) => item.text);
  }

  return result;
}

function extractJsonBlock(text) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] || "";
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

function buildExpertUserContent({ prompt, imagePayloads }) {
  const content = [{ type: "text", text: prompt }];
  for (const image of imagePayloads) {
    content.push({
      type: "image_url",
      image_url: { url: image.dataUrl || image.url },
    });
  }
  return content.length === 1 ? prompt : content;
}

async function buildExpertSystemPrompt(expert) {
  return injectCurrentTimeSystemReminder(
    `你是 Council 专家面板中的「${getCouncilExpertDisplayLabel(expert)}」。请独立、完整地回答用户问题。
输出 Markdown 格式。直接给出你的分析和结论，不要提及其他 AI 模型或 Council 机制。`
  );
}

async function buildCouncilAnalysisSystemPrompt() {
  const [firstExpertLabel = "GPT", secondExpertLabel = "Claude", thirdExpertLabel = "Gemini"] =
    COUNCIL_EXPERT_CONFIGS.map((expert) => getCouncilExpertDisplayLabel(expert));
  return injectCurrentTimeSystemReminder(`你是 Council 的对比分析器。你会收到用户问题、三位专家的完整原始回答。你的任务是把三位专家的观点差异整理成结构化 JSON，供后续正式回复使用。

重要输入边界：
- 你可能还会收到"历史对话纪要"。它只是此前 Council 已得出的背景结论，不代表这些内容在本轮已经被重新核验。
- 你看到的是用户文字问题，不直接看到用户上传的原始图片或其他原始多模态内容。
- 如果专家回答里涉及图片、图表、截图、文件等内容，你只能依据专家已经写出的描述、结论进行汇总，不能假装自己也看过原始材料。

必须严格遵守：
1. 你必须只输出 JSON，对象顶层只能包含这 5 个键：agreement、keyDifferences、partialCoverage、uniqueInsights、blindSpots
2. 这 5 个键的值都必须是数组。数组项必须是对象，且只能包含 text（字符串）和 models（字符串数组）
3. models 里只允许出现这 3 个短名：${firstExpertLabel}、${secondExpertLabel}、${thirdExpertLabel}
4. agreement：写明确共识。只有在某位专家明确表达过这一点时，才把该专家写进 models
5. keyDifferences：写真正影响结论的关键分歧
6. partialCoverage：写只有部分专家覆盖到，或覆盖明显不完整的重要信息
7. uniqueInsights：写某个或某两个专家提供的独特价值信息
8. blindSpots：写三位专家整体遗漏掉、但会影响用户判断的重要空白
9. 所有 text 都必须基于专家回答，不能脑补，不能虚构
10. 如果某组没有内容，返回空数组，不要写占位文案
11. 不要输出 Markdown，不要输出代码块，不要输出解释文字`);
}

async function buildCouncilFinalAnswerSystemPrompt() {
  return injectCurrentTimeSystemReminder(`你是 Council 的最终正式回复模型。你会收到用户问题、结构化对比分析、三位专家的完整原始回答。你的任务是直接面向用户给出正式回复。

重要输入边界：
- 你可能还会收到"历史对话纪要"。它只是此前 Council 已得出的背景结论，不代表这些内容在本轮已经被重新核验。
- 你看到的是用户文字问题，不直接看到用户上传的原始图片或其他原始多模态内容。
- 你的正式回复必须建立在专家已经明确说过的观点、理由、证据之上，不能凭空增加新事实、新证据。

必须严格遵守：
1. 输出必须是 Markdown
2. 第一行必须且只能是一个 H1 标题
3. H1 下面直接开始正文，不要再输出任何其他标题
4. 正文必须先直接回答用户当前问题，明确给出结论、建议、判断或做法
5. 你可以整合三位专家的共识、分歧、独特洞察和盲点，但不要把回答写成模型对比报告
6. 当专家意见不一致时，你要替用户做整合判断，给出更稳妥的理解或分情况建议
7. 不要泄露思维链，不要输出裸链接`);
}

async function requestSynthesisText({
  instructions,
  payloadText,
  maxTokens,
  reasoningEffort = "high",
  signal,
}) {
  throwIfAborted(signal);
  const response = await requestZenMuxChatCompletionResponse({
    model: COUNCIL_SYNTHESIS_MODEL,
    system: instructions,
    messages: [{ role: "user", content: payloadText }],
    maxTokens,
    reasoningEffort,
    signal,
  });
  const text = getChatCompletionOutputText(response);
  if (!text) {
    throw new Error("Doubao 未返回有效内容");
  }
  return text;
}

function normalizeExpertOutput(rawText, expert) {
  const rawMarkdown = normalizeString(rawText, MAX_RAW_MARKDOWN_CHARS);
  if (!rawMarkdown) {
    throw new Error(`${expert.label} 未返回有效内容`);
  }
  return {
    modelId: expert.modelId,
    label: expert.label,
    rawMarkdown,
    citations: [],
  };
}

export async function runCouncilExpert({
  prompt,
  historyMemo,
  imagePayloads,
  expert,
  clientAborted,
  updateStatus,
  onDone,
  signal,
}) {
  try {
    const startedAt = Date.now();
    const finalPrompt = buildCouncilTurnPrompt({ historyMemo, prompt });
    throwIfAborted(signal);
    if (clientAborted()) throw new Error("COUNCIL_ABORTED");

    updateStatus?.({
      status: "running",
      phase: "thinking",
      message: "思考中",
    });

    const system = await buildExpertSystemPrompt(expert);
    const userContent = buildExpertUserContent({
      prompt: finalPrompt,
      imagePayloads: Array.isArray(imagePayloads) ? imagePayloads : [],
    });

    const response = await requestZenMuxChatCompletionResponse({
      model: expert.modelId,
      system,
      messages: [{ role: "user", content: userContent }],
      maxTokens: EXPERT_MAX_OUTPUT_TOKENS,
      reasoningEffort: expert.thinkingLevel,
      signal,
    });

    const rawText = getChatCompletionOutputText(response);
    const normalized = {
      ...normalizeExpertOutput(rawText, expert),
      durationMs: Math.max(0, Date.now() - startedAt),
    };
    onDone?.(normalized);
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

function buildCouncilSourcePayload({ historyMemo, prompt, experts }) {
  const sections = [
    ...(historyMemo ? ["# 历史对话纪要", historyMemo] : []),
    `# 用户问题\n${prompt}`,
    "# 专家原始回答",
  ];

  for (const expert of experts) {
    sections.push(`## ${expert.label}`, expert.rawMarkdown);
  }

  return sections.join("\n\n");
}

function buildCouncilAnalysisDigest(analysis) {
  const lines = ["# 对比分析结果"];
  for (const key of COUNCIL_ANALYSIS_GROUP_KEYS) {
    lines.push(`## ${COUNCIL_ANALYSIS_SECTION_LABELS[key]}`);
    const items = Array.isArray(analysis?.[key]) ? analysis[key] : [];
    if (items.length === 0) {
      lines.push("无");
      continue;
    }
    for (const item of items) {
      const models = Array.isArray(item?.models) && item.models.length > 0
        ? `（${item.models.join(" / ")}）`
        : "";
      lines.push(`- ${item.text}${models}`);
    }
  }
  return lines.join("\n");
}

export async function runCouncilTriage({ prompt, hasImages, signal }) {
  if (hasImages) return { needCouncil: true };
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed) return { needCouncil: true };
  if (!shouldAllowCouncilDirectAnswer(trimmed)) {
    return { needCouncil: true };
  }

  try {
    const text = await requestSynthesisText({
      instructions: `你是 Council 路由判断器。Council 会并行调用三位专家模型讨论。你的判断必须非常保守，只有在用户消息明显属于"打招呼 / 非常简单的一句话小问题"时，才允许跳过专家。

只有以下两类，才可以不调用 Council（直接回答）：
- 打招呼、问候、感谢、确认、寒暄，例如"你好""在吗""谢谢""好的"
- 非常简单的一句话小问题，并且满足：很短、没有分析要求、没有创作要求、没有专业判断要求、没有多步骤要求

下面这些一律必须调用 Council（返回 needCouncil: true）：
- 任何分析、比较、解释、总结、推荐、评估、研究
- 任何编程、调试、代码、脚本、报错、审查
- 任何写作、创作、文案、策划、方案、提示词
- 任何带明显专业判断的问题
- 只要你有一丝犹豫，就必须调用 Council

你要默认"调用 Council"，而不是默认"跳过专家"。

你必须返回 JSON，不要输出其他内容。
如果不需要 Council，同时给出直接回答：
{"needCouncil":false,"directAnswer":"你的回答内容"}
如果需要 Council：
{"needCouncil":true}`,
      payloadText: trimmed,
      maxTokens: TRIAGE_MAX_OUTPUT_TOKENS,
      reasoningEffort: "minimal",
      signal,
    });

    const jsonText = extractJsonBlock(text);
    if (!jsonText) return { needCouncil: true };

    const parsed = JSON.parse(jsonText);
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

export async function runCouncilAnalysis({ historyMemo, prompt, experts, signal }) {
  const instructions = await buildCouncilAnalysisSystemPrompt();
  const text = await requestSynthesisText({
    instructions,
    payloadText: buildCouncilSourcePayload({ historyMemo, prompt, experts }),
    maxTokens: COUNCIL_ANALYSIS_MAX_OUTPUT_TOKENS,
    reasoningEffort: "high",
    signal,
  });

  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    throw new Error("Doubao 未返回有效的分析 JSON");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Doubao 返回的分析 JSON 无法解析");
  }

  return normalizeCouncilAnalysisPayload(parsed);
}

export async function runCouncilFinalAnswer({ historyMemo, prompt, experts, analysis, signal }) {
  const instructions = await buildCouncilFinalAnswerSystemPrompt();
  const text = await requestSynthesisText({
    instructions,
    payloadText: [
      buildCouncilSourcePayload({ historyMemo, prompt, experts }),
      buildCouncilAnalysisDigest(analysis),
    ].join("\n\n"),
    maxTokens: COUNCIL_RESULT_MAX_OUTPUT_TOKENS,
    reasoningEffort: "high",
    signal,
  });

  const normalized = normalizeString(text, MAX_RAW_MARKDOWN_CHARS);
  if (!normalized) {
    throw new Error("Doubao 未返回有效正式回复");
  }
  if (!/^#\s+.+/m.test(normalized)) {
    throw new Error("Doubao 返回的正式回复缺少 H1 标题");
  }
  return normalized;
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
  analysis,
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
      durationMs: expert.durationMs,
    })),
    ...(analysis ? { councilAnalysis: analysis } : {}),
  };
}
