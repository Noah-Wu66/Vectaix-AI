import { GoogleGenAI } from '@google/genai';
import { injectCurrentTimeSystemReminder } from '@/app/api/chat/utils';
import {
  metasoSearch,
  buildMetasoContext,
  metasoReader,
  buildMetasoReaderContext,
  buildMetasoCitations,
  buildMetasoSearchEventResults,
} from '@/app/api/chat/metasoSearch';
import { parseJsonFromText } from '@/app/api/chat/jsonUtils';

const DECISION_SYSTEM_TEXT = '你是联网检索决策器。必须只输出严格 JSON，不要输出任何多余文本。';
const READER_SYSTEM_TEXT = '你是网页全文查看决策器。必须只输出严格 JSON，不要输出任何多余文本。';
const CONTINUE_SYSTEM_TEXT = '你是网页阅读继续决策器。必须只输出严格 JSON，不要输出任何多余文本。';
const ENOUGH_SYSTEM_TEXT = '你是联网检索补充决策器。必须只输出严格 JSON，不要输出任何多余文本。';
const INTERNAL_DECISION_MODEL = 'google/gemini-3-flash-preview';
const INTERNAL_VERTEX_BASE_URL = 'https://zenmux.ai/api/vertex-ai';

let decisionClient;

function getDecisionClient() {
  if (!decisionClient) {
    decisionClient = new GoogleGenAI({
      apiKey: process.env.ZENMUX_API_KEY,
      httpOptions: { apiVersion: 'v1', baseUrl: INTERNAL_VERTEX_BASE_URL },
    });
  }
  return decisionClient;
}

async function runInternalDecision({ systemText, userText, isAborted, onThought }) {
  const ai = getDecisionClient();
  let decisionText = '';
  const stream = await ai.models.generateContentStream({
    model: INTERNAL_DECISION_MODEL,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    config: {
      systemInstruction: { parts: [{ text: systemText }] },
    },
  });

  for await (const chunk of stream) {
    if (isAborted?.()) break;
    const candidate = chunk.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      if (isAborted?.()) break;
      if (part.thought && part.text) {
        onThought?.(part.text);
      } else if (part.text) {
        decisionText += part.text;
      }
    }
  }

  return decisionText;
}

export function buildWebSearchGuide(enableWebSearch) {
  return enableWebSearch
    ? '\n\nDo not add source domains or URLs in parentheses in your reply.'
    : '';
}

export async function runWebSearchOrchestration(options) {
  const {
    enableWebSearch,
    prompt,
    sendEvent,
    pushCitations,
    sendSearchError,
    isClientAborted,
    providerLabel = 'AI',
    model,
    conversationId,
    maxSearchRounds = 10,
    maxReadPages = 10,
    readerMaxContentChars = 10000,
    logDecision = false,
    warnOnEmptyResults = false,
    warnOnNoContext = false,
  } = options || {};

  const aborted = () => typeof isClientAborted === 'function' && isClientAborted() === true;
  if (!enableWebSearch || aborted()) {
    return { searchContextText: '' };
  }

  const runDecision = (systemText, userText) => runInternalDecision({
    systemText,
    userText,
    isAborted: aborted,
    onThought: (content) => sendEvent({ type: 'thought', content }),
  });

  const decisionSystem = injectCurrentTimeSystemReminder(DECISION_SYSTEM_TEXT);
  const decisionUser = `用户问题：${prompt}\n\n判断是否必须联网检索才能回答。\n- 需要联网：输出 {"needSearch": true, "query": "精炼检索词"}\n- 不需要联网：输出 {"needSearch": false}`;
  const decisionText = await runDecision(decisionSystem, decisionUser);
  const decision = parseJsonFromText(decisionText);
  let needSearch = decision?.needSearch === true;
  let nextQuery = typeof decision?.query === 'string' ? decision.query.trim() : '';

  if (logDecision) {
    console.info(`${providerLabel} web search decision`, {
      needSearch,
      hasQuery: Boolean(nextQuery),
      model,
      conversationId,
    });
  }

  const searchContextParts = [];
  const readUrlSet = new Set();

  for (let round = 0; round < maxSearchRounds && needSearch && nextQuery; round++) {
    if (aborted()) break;
    sendEvent({ type: 'search_start', query: nextQuery });

    let results = [];
    let searchFailed = false;
    try {
      const searchData = await metasoSearch(nextQuery, {
        scope: 'webpage',
        includeSummary: false,
        size: 100,
        includeRawContent: false,
        conciseSnippet: true,
      });
      results = searchData?.results;
    } catch (searchError) {
      console.error(`${providerLabel} web search failed`, {
        query: nextQuery,
        message: searchError?.message,
        name: searchError?.name,
      });
      const msg = searchError?.message?.includes('METASO_API_KEY')
        ? '未配置搜索服务'
        : '检索失败，请稍后再试';
      if (typeof sendSearchError === 'function') {
        sendSearchError(msg);
      }
      searchFailed = true;
    }

    if (searchFailed) break;

    if (warnOnEmptyResults && (!Array.isArray(results) || results.length === 0)) {
      console.warn(`${providerLabel} web search empty results`, {
        query: nextQuery,
        round: round + 1,
      });
    }

    sendEvent({
      type: 'search_result',
      query: nextQuery,
      results: buildMetasoSearchEventResults(results),
    });

    if (typeof pushCitations === 'function') {
      pushCitations(buildMetasoCitations(results));
    }

    const roundContextBlocks = [];
    let skipEnoughCheck = false;

    const contextBlock = buildMetasoContext(results);
    if (contextBlock) {
      roundContextBlocks.push(contextBlock);
    }

    const readerCandidates = Array.isArray(results) ? results : [];
    if (readerCandidates.length > 0 && readUrlSet.size < maxReadPages) {
      try {
        const readerSystem = injectCurrentTimeSystemReminder(READER_SYSTEM_TEXT);
        const remainingQuota = maxReadPages - readUrlSet.size;
        const candidateText = readerCandidates
          .map((item, idx) => {
            const title = typeof item?.title === 'string' ? item.title : '';
            const url = typeof item?.url === 'string' ? item.url : '';
            const rawSnippet = typeof item?.snippet === 'string' && item.snippet.trim()
              ? item.snippet.trim()
              : (typeof item?.summary === 'string' ? item.summary.trim() : '');
            return `[${idx + 1}] ${title}\nURL: ${url}\n片段: ${rawSnippet || '（无）'}`;
          })
          .join('\n\n');
        const alreadyRead = Array.from(readUrlSet);
        const readerUser = `用户问题：${prompt}\n当前检索词：${nextQuery}\n\n候选结果：\n${candidateText}\n\n已查看过的 URL：\n${alreadyRead.length > 0 ? alreadyRead.join('\n') : '无'}\n\n剩余可查看配额：${remainingQuota} 个网页\n\n判断是否需要查看网页正文来提升答案质量。可以同时选择多个网页（不超过剩余配额）。\n- 需要：输出 {"needRead": true, "urls": ["候选URL1", "候选URL2", ...]}\n- 不需要：输出 {"needRead": false}`;
        const readerDecisionText = await runDecision(readerSystem, readerUser);
        const readerDecision = parseJsonFromText(readerDecisionText);
        const shouldRead = readerDecision?.needRead === true;
        const selectedUrls = Array.isArray(readerDecision?.urls)
          ? readerDecision.urls.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
          : [];

        if (shouldRead && selectedUrls.length > 0) {
          for (let ri = 0; ri < selectedUrls.length; ri++) {
            const selectedUrl = selectedUrls[ri];
            if (readUrlSet.size >= maxReadPages) break;
            if (readUrlSet.has(selectedUrl)) continue;

            const selectedItem = readerCandidates.find((item) => item?.url === selectedUrl);
            if (!selectedItem) continue;

            sendEvent({ type: 'search_reader_start', url: selectedItem.url, title: selectedItem.title });

            try {
              const readerData = await metasoReader(selectedItem.url);
              const readerContext = buildMetasoReaderContext(
                {
                  title: selectedItem.title,
                  url: selectedItem.url,
                  content: readerData?.content,
                },
                { maxContentChars: readerMaxContentChars }
              );

              if (readerContext) {
                roundContextBlocks.push(readerContext);
                readUrlSet.add(selectedItem.url);
                sendEvent({
                  type: 'search_reader_result',
                  url: selectedItem.url,
                  title: selectedItem.title,
                });
              }
            } catch (readerError) {
              console.error(`${providerLabel} web reader failed`, {
                url: selectedItem.url,
                message: readerError?.message,
                name: readerError?.name,
              });
              sendEvent({ type: 'search_reader_error', url: selectedItem.url, title: selectedItem.title });
            }

            const remainingUrls = selectedUrls.slice(ri + 1).filter((u) => !readUrlSet.has(u));
            if (remainingUrls.length > 0 && readUrlSet.size < maxReadPages) {
              try {
                const continueSystem = injectCurrentTimeSystemReminder(CONTINUE_SYSTEM_TEXT);
                const readSoFar = Array.from(readUrlSet).join('\n');
                const pendingList = remainingUrls.join('\n');
                const continueUser = `用户问题：${prompt}\n\n已查看的网页内容摘要：\n${roundContextBlocks.join('\n\n')}\n\n待查看的 URL：\n${pendingList}\n\n已读过的全部 URL：\n${readSoFar}\n\n根据已获取的信息，判断：\n1. 是否还需要继续查看剩余网页\n2. 当前信息是否已足够回答用户问题，是否还需要下一轮搜索\n\n- 继续查看剩余网页：输出 {"continueRead": true}\n- 不再查看，但信息不够需要换词搜索：输出 {"continueRead": false, "enough": false, "nextQuery": "新的检索词"}\n- 不再查看，信息已足够：输出 {"continueRead": false, "enough": true}`;
                const continueText = await runDecision(continueSystem, continueUser);
                const continueDecision = parseJsonFromText(continueText);
                if (continueDecision?.continueRead === false) {
                  if (continueDecision?.enough === true) {
                    skipEnoughCheck = true;
                    needSearch = false;
                  } else if (
                    continueDecision?.enough === false
                    && typeof continueDecision?.nextQuery === 'string'
                    && continueDecision.nextQuery.trim()
                  ) {
                    skipEnoughCheck = true;
                    nextQuery = continueDecision.nextQuery.trim();
                  }
                  break;
                }
              } catch (continueError) {
                console.error(`${providerLabel} continue-read decision failed`, {
                  message: continueError?.message,
                });
              }
            }
          }
        }
      } catch (readerDecisionError) {
        console.error(`${providerLabel} web reader decision failed`, {
          query: nextQuery,
          message: readerDecisionError?.message,
          name: readerDecisionError?.name,
        });
      }
    }

    if (roundContextBlocks.length > 0) {
      searchContextParts.push(`检索词: ${nextQuery}\n${roundContextBlocks.join('\n\n')}`);
    }

    if (round === maxSearchRounds - 1) break;
    if (skipEnoughCheck) continue;

    const recentContext = searchContextParts.join('\n\n');
    const enoughSystem = injectCurrentTimeSystemReminder(ENOUGH_SYSTEM_TEXT);
    const enoughUser = `用户问题：${prompt}\n\n已获得的检索摘要：\n${recentContext}\n\n判断这些信息是否足够回答。\n- 足够：输出 {"enough": true}\n- 不足：输出 {"enough": false, "nextQuery": "新的检索词"}`;
    const enoughText = await runDecision(enoughSystem, enoughUser);
    const enoughDecision = parseJsonFromText(enoughText);
    if (enoughDecision?.enough === true) break;
    const candidateQuery = typeof enoughDecision?.nextQuery === 'string'
      ? enoughDecision.nextQuery.trim()
      : '';
    if (!candidateQuery || candidateQuery === nextQuery) break;
    nextQuery = candidateQuery;
  }

  const searchContextText = searchContextParts.join('\n\n');
  if (warnOnNoContext && !searchContextText) {
    console.warn(`${providerLabel} web search produced no context`, {
      needSearch,
      lastQuery: nextQuery,
      rounds: searchContextParts.length,
    });
  }

  return { searchContextText };
}
