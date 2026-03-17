// ChatApp - 主聊天应用组件
"use client";
import { useEffect, useRef, useState } from "react";
import { createChatAppActions } from "@/lib/client/chat/chatAppActions";
import { useThemeMode } from "@/lib/client/hooks/useThemeMode";
import { useUserSettings } from "@/lib/client/hooks/useUserSettings";
import {
  AGENT_MODEL_ID,
  CHAT_MODELS,
  CLAUDE_SONNET_MODEL,
  COUNCIL_MODEL_ID,
  DEEPSEEK_REASONER_MODEL,
  GEMINI_FLASH_MODEL,
  OPENAI_PRIMARY_MODEL,
  SEED_MODEL_ID,
  isCouncilModel,
  normalizeModelId,
} from "@/lib/shared/models";
import { useToast } from "./components/ToastProvider";
import AuthModal from "./components/AuthModal";
import ConfirmModal from "./components/ConfirmModal";
import ChatLayout from "./components/ChatLayout";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
const CHAT_RUN_ACTIVE_STATUSES = new Set(["queued", "running"]);
const AGENT_RUN_STREAMING_STATUSES = new Set(["queued", "running"]);
const PENDING_MESSAGE_TEXTS = new Set(["正在处理中...", "Council 正在处理中..."]);

function hasDisplayableModelProgress(message) {
  if (!message || message.role !== "model") return false;

  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (content && !PENDING_MESSAGE_TEXTS.has(content)) {
    return true;
  }

  if (typeof message.thought === "string" && message.thought.trim()) {
    return true;
  }

  if (typeof message.searchError === "string" && message.searchError.trim()) {
    return true;
  }

  if (Array.isArray(message.parts) && message.parts.some((part) => {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    return text && !PENDING_MESSAGE_TEXTS.has(text);
  })) {
    return true;
  }

  if (Array.isArray(message.thinkingTimeline) && message.thinkingTimeline.length > 0) {
    return true;
  }

  if (Array.isArray(message.councilExpertStates) && message.councilExpertStates.length > 0) {
    return true;
  }

  if (message.councilSummaryState && typeof message.councilSummaryState === "object") {
    return true;
  }

  return false;
}

function hasActiveStreamingRun(message) {
  if (!message || message.role !== "model") return false;
  const chatRunStatus = String(message?.chatRun?.status || "");
  const agentRunStatus = String(message?.agentRun?.status || "");
  return CHAT_RUN_ACTIVE_STATUSES.has(chatRunStatus) || AGENT_RUN_STREAMING_STATUSES.has(agentRunStatus);
}

function decorateConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (!hasActiveStreamingRun(message)) return message;
    const hasProgress = hasDisplayableModelProgress(message);
    return {
      ...message,
      isStreaming: true,
      isWaitingFirstChunk: !hasProgress,
      isThinkingStreaming: !hasProgress || Boolean(message?.isThinkingStreaming),
    };
  });
}

function mergeConversationMessages(serverMessages, localMessages) {
  const nextServerMessages = decorateConversationMessages(serverMessages);
  if (!Array.isArray(localMessages) || localMessages.length === 0) {
    return nextServerMessages;
  }

  const localById = new Map(
    localMessages
      .filter((message) => typeof message?.id === "string" && message.id)
      .map((message) => [message.id, message]),
  );

  const serverIds = new Set(
    nextServerMessages
      .filter((message) => typeof message?.id === "string" && message.id)
      .map((message) => message.id),
  );

  const merged = nextServerMessages.map((serverMessage) => {
    const localMessage = localById.get(serverMessage?.id);
    if (!localMessage) return serverMessage;

    const nextMessage = { ...serverMessage };
    const serverContent = typeof serverMessage?.content === "string" ? serverMessage.content : "";
    const localContent = typeof localMessage?.content === "string" ? localMessage.content : "";

    if (localContent.length > serverContent.length) {
      nextMessage.content = localContent;
      if (Array.isArray(localMessage?.parts) && localMessage.parts.length > 0) {
        nextMessage.parts = localMessage.parts;
      }
    }

    const serverThought = typeof serverMessage?.thought === "string" ? serverMessage.thought : "";
    const localThought = typeof localMessage?.thought === "string" ? localMessage.thought : "";
    if (localThought.length > serverThought.length) {
      nextMessage.thought = localThought;
    }

    if (
      Array.isArray(localMessage?.thinkingTimeline)
      && localMessage.thinkingTimeline.length > (Array.isArray(serverMessage?.thinkingTimeline) ? serverMessage.thinkingTimeline.length : 0)
    ) {
      nextMessage.thinkingTimeline = localMessage.thinkingTimeline;
    }

    if (
      Array.isArray(localMessage?.councilExpertStates)
      && localMessage.councilExpertStates.length > (Array.isArray(serverMessage?.councilExpertStates) ? serverMessage.councilExpertStates.length : 0)
    ) {
      nextMessage.councilExpertStates = localMessage.councilExpertStates;
    }

    if (
      Array.isArray(localMessage?.councilExperts)
      && localMessage.councilExperts.length > (Array.isArray(serverMessage?.councilExperts) ? serverMessage.councilExperts.length : 0)
    ) {
      nextMessage.councilExperts = localMessage.councilExperts;
    }

    if (
      Array.isArray(localMessage?.citations)
      && localMessage.citations.length > (Array.isArray(serverMessage?.citations) ? serverMessage.citations.length : 0)
    ) {
      nextMessage.citations = localMessage.citations;
    }

    if (!nextMessage.searchError && localMessage?.searchError) {
      nextMessage.searchError = localMessage.searchError;
    }

    if (!nextMessage.searchQuery && localMessage?.searchQuery) {
      nextMessage.searchQuery = localMessage.searchQuery;
    }

    if (!nextMessage.searchResults && localMessage?.searchResults) {
      nextMessage.searchResults = localMessage.searchResults;
    }

    if (!nextMessage.councilSummaryState && localMessage?.councilSummaryState) {
      nextMessage.councilSummaryState = localMessage.councilSummaryState;
    }

    if (serverMessage?.isStreaming) {
      nextMessage.isStreaming = true;
      nextMessage.isWaitingFirstChunk = Boolean(serverMessage?.isWaitingFirstChunk)
        || (Boolean(localMessage?.isWaitingFirstChunk) && !hasDisplayableModelProgress(serverMessage));
      nextMessage.isThinkingStreaming = Boolean(serverMessage?.isThinkingStreaming)
        || Boolean(localMessage?.isThinkingStreaming);
    }

    return nextMessage;
  });

  const trailingLocalMessages = [];
  for (let i = localMessages.length - 1; i >= 0; i -= 1) {
    const message = localMessages[i];
    const messageId = typeof message?.id === "string" ? message.id : "";
    if (messageId && serverIds.has(messageId)) {
      break;
    }
    trailingLocalMessages.unshift(message);
  }

  if (trailingLocalMessages.length === 0) {
    return merged;
  }

  return [...merged, ...trailingLocalMessages];
}

export default function ChatApp() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeRuns, setActiveRuns] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const mediaResolution = "media_resolution_high";
  const { model, isSettingsReady, setModel, thinkingLevels, historyLimit, maxTokens, webSearch, setWebSearch, systemPrompts, activePromptIds, setActivePromptIds, activePromptId, setActivePromptId, themeMode, setThemeMode, fontSize, setFontSize, completionSoundVolume, setCompletionSoundVolume, settingsError, setSettingsError, fetchSettings, addPrompt, deletePrompt, updatePrompt, avatar, setAvatar } = useUserSettings();
  useThemeMode(themeMode);
  const currentModelConfig = CHAT_MODELS.find((m) => m.id === model);
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  // 编辑并重新生成：图片编辑状态
  // - keep: 保留原图（如有）
  // - remove: 移除图片
  // - new: 选择了新图片（替换/新增）
  const [editingImageAction, setEditingImageAction] = useState("keep");
  const [editingImage, setEditingImage] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState({ text: "", nonce: 0 });

  const chatEndRef = useRef(null);
  const messageListRef = useRef(null);
  const userInterruptedRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);
  const scrollRafRef = useRef(0);
  const chatAbortRef = useRef(null);
  const chatRequestLockRef = useRef(false);
  const autoResumeRunIdRef = useRef(null);
  const syncSettingsTimeoutRef = useRef(null);
  const pendingSettingsRef = useRef({});
  const pendingConversationIdRef = useRef(null);
  const lastTextModelRef = useRef(GEMINI_FLASH_MODEL);
  const hasRestoredConversationRef = useRef(false);
  const currentConversationIdRef = useRef(null);
  const activeRunsPollInFlightRef = useRef(false);
  const conversationPollInFlightRef = useRef(false);
  const isStreamingRef = useRef(false);
  const isStreaming = messages.some((message) => {
    const chatRunStatus = String(message?.chatRun?.status || "");
    return (
      message?.isStreaming === true ||
      chatRunStatus === "queued" ||
      chatRunStatus === "running"
    );
  });
  isStreamingRef.current = isStreaming;
  const SCROLL_BOTTOM_THRESHOLD = 80;
  const lastSettingsErrorRef = useRef(null);

  // 监听 settingsError 变化，显示 toast
  useEffect(() => {
    if (settingsError && settingsError !== lastSettingsErrorRef.current) {
      toast.error(settingsError);
      lastSettingsErrorRef.current = settingsError;
    }
  }, [settingsError, toast]);

  const stopOngoingChatWork = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    userInterruptedRef.current = false;
    if (syncSettingsTimeoutRef.current) {
      clearTimeout(syncSettingsTimeoutRef.current);
      syncSettingsTimeoutRef.current = null;
    }
    pendingSettingsRef.current = {};
    pendingConversationIdRef.current = null;
    setLoading(false);
  };

  const handleAuthExpired = () => {
    stopOngoingChatWork();
    hasRestoredConversationRef.current = false;
    setUser(null);
    setConversations([]);
    setActiveRuns([]);
    setCurrentConversationId(null);
    setMessages([]);
    setSettingsError(null);
    setShowProfileModal(false);
    setShowAuthModal(true);
    setAuthMode("login");
    setPassword("");
    setConfirmPassword("");
  };

  const distanceToBottom = (el) => {
    if (!el) return 0;
    const top = Number.isFinite(el.scrollTop) ? el.scrollTop : 0;
    const height = Number.isFinite(el.clientHeight) ? el.clientHeight : 0;
    const scrollHeight = Number.isFinite(el.scrollHeight) ? el.scrollHeight : 0;
    return Math.max(0, scrollHeight - (top + height));
  };

  const isNearBottom = (el) => distanceToBottom(el) <= SCROLL_BOTTOM_THRESHOLD;

  const scrollToBottom = () => {
    const el = messageListRef.current;
    if (!el) return;
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = top;
  };

  const scheduleScrollToBottom = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      scrollToBottom();
    });
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          fetchConversations();
          fetchActiveRuns();
          fetchSettings(); // 只获取系统提示词
        } else {
          handleAuthExpired();
        }
      })
      .catch(() => {
        handleAuthExpired();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
    if (typeof window === "undefined") return;
    if (currentConversationId) {
      window.localStorage.setItem("vectaix-current-conversation", currentConversationId);
      return;
    }
    window.localStorage.removeItem("vectaix-current-conversation");
  }, [currentConversationId]);

  useEffect(() => {
    if (!user || hasRestoredConversationRef.current || conversations.length === 0) return;
    hasRestoredConversationRef.current = true;
    if (typeof window === "undefined") return;
    const savedConversationId = window.localStorage.getItem("vectaix-current-conversation");
    if (!savedConversationId) return;
    const exists = conversations.some((conversation) => conversation?._id === savedConversationId);
    if (exists) {
      loadConversation(savedConversationId, { silent: true });
    }
  }, [conversations, user]);

  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => {
      if (activeRunsPollInFlightRef.current) return;
      activeRunsPollInFlightRef.current = true;
      fetchActiveRuns().finally(() => {
        activeRunsPollInFlightRef.current = false;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (!currentConversationId) return undefined;
    const hasConversationRun = conversations.some(
      (conversation) => conversation?._id === currentConversationId && conversation?.hasActiveRun
    );
    const hasMessageRun = messages.some((message) => {
      const chatRunStatus = String(message?.chatRun?.status || "");
      const agentRunStatus = String(message?.agentRun?.status || "");
      return (
        chatRunStatus === "queued" ||
        chatRunStatus === "running" ||
        agentRunStatus === "running" ||
        agentRunStatus === "waiting_continue" ||
        agentRunStatus === "awaiting_approval"
      );
    });
    if (!hasConversationRun && !hasMessageRun) return undefined;

    const timer = setInterval(() => {
      const targetConversationId = currentConversationIdRef.current;
      if (!targetConversationId || conversationPollInFlightRef.current) return;
      conversationPollInFlightRef.current = true;
      loadConversation(targetConversationId, { silent: true }).finally(() => {
        conversationPollInFlightRef.current = false;
      });
    }, 1200);
    return () => clearInterval(timer);
  }, [conversations, currentConversationId, messages]);

  // Cleanup: abort pending requests on unmount
  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
      if (syncSettingsTimeoutRef.current) {
        clearTimeout(syncSettingsTimeoutRef.current);
        syncSettingsTimeoutRef.current = null;
      }
      pendingSettingsRef.current = {};
      pendingConversationIdRef.current = null;
      activeRunsPollInFlightRef.current = false;
      conversationPollInFlightRef.current = false;
    };
  }, []);

  const sortConversations = (list) => {
    if (!Array.isArray(list)) return [];
    return list.slice().sort((a, b) => {
      const ap = a?.pinned ? 1 : 0;
      const bp = b?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const at = new Date(a?.updatedAt || 0).getTime();
      const bt = new Date(b?.updatedAt || 0).getTime();
      return bt - at;
    });
  };

  const mergeConversationRunState = (list, runs = activeRuns) => {
    if (!Array.isArray(list)) return [];
    const activeConversationIds = new Set(
      (Array.isArray(runs) ? runs : [])
        .map((run) => (typeof run?.conversationId === "string" ? run.conversationId : ""))
        .filter(Boolean)
    );
    return list.map((conversation) => ({
      ...conversation,
      hasActiveRun: activeConversationIds.has(conversation?._id),
    }));
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        handleAuthExpired();
        return;
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) return;
      const nextConversations = data?.conversations
        ? sortConversations(mergeConversationRunState(data.conversations))
        : [];
      setConversations(nextConversations);
      if (currentConversationId && !nextConversations.some((conv) => conv._id === currentConversationId)) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch { }
  };

  const fetchActiveRuns = async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      if (res.status === 401) {
        handleAuthExpired();
        return [];
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) return [];
      const nextRuns = Array.isArray(data?.runs) ? data.runs : [];
      setActiveRuns(nextRuns);
      setConversations((prev) => sortConversations(mergeConversationRunState(prev, nextRuns)));
      return nextRuns;
    } catch {
      return [];
    }
  };

  const handleConversationMissing = () => {
    stopOngoingChatWork();
    setCurrentConversationId(null);
    setMessages([]);
    fetchConversations();
  };

  const handleSensitiveRefusal = (payload) => {
    const promptText = typeof payload === "string" ? payload : payload?.prompt;
    const shouldPrefill = typeof payload === "object" ? payload?.shouldPrefill !== false : true;
    toast.warning("消息包含敏感内容，请修改后重新尝试");
    if (shouldPrefill && typeof promptText === "string" && promptText.trim()) {
      setComposerPrefill({ text: promptText, nonce: Date.now() });
    }
  };

  const actions = createChatAppActions({
    toast,
    messages,
    setMessages,
    loading,
    setLoading,
    model,
    thinkingLevels,
    mediaResolution,
    systemPrompts,
    activePromptId,
    maxTokens,
    webSearch,
    historyLimit,
    currentConversationId,
    setCurrentConversationId,
    fetchConversations,
    chatAbortRef,
    chatRequestLockRef,
    userInterruptedRef,
    editingMsgIndex,
    editingContent,
    editingImageAction,
    editingImage,
    setEditingMsgIndex,
    setEditingContent,
    setEditingImageAction,
    setEditingImage,
    completionSoundVolume,
    onSensitiveRefusal: handleSensitiveRefusal,
    onAuthExpired: handleAuthExpired,
    onConversationMissing: handleConversationMissing,
    onConversationActivity: (id) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c._id === id);
        if (idx < 0) return prev;
        const next = prev.slice();
        next[idx] = { ...next[idx], updatedAt: new Date().toISOString() };
        return sortConversations(next);
      });
    },
    loadConversationById: (...args) => loadConversation(...args),
  });

  useEffect(() => {
    if (!wasStreamingRef.current && isStreaming) {
      userInterruptedRef.current = false;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (loading || model !== AGENT_MODEL_ID || !currentConversationId) return;
    const index = messages.findIndex((msg) =>
      msg?.role === "model" &&
      msg?.agentRun?.status === "waiting_continue" &&
      msg?.agentRun?.canResume === true &&
      typeof msg?.agentRun?.runId === "string" &&
      msg.agentRun.runId
    );
    if (index < 0) return;
    const runId = messages[index]?.agentRun?.runId;
    if (!runId || autoResumeRunIdRef.current === runId) return;
    autoResumeRunIdRef.current = runId;
    actions.continueAgentRun(index).finally(() => {
      if (autoResumeRunIdRef.current === runId) {
        autoResumeRunIdRef.current = null;
      }
    });
  }, [actions, currentConversationId, loading, messages, model]);

  useEffect(() => {
    if (userInterruptedRef.current) return;
    // 等待 DOM/Markdown 渲染完毕后执行滚动，提升移动端键盘弹出时的体验稳定性
    scheduleScrollToBottom();
    if (!isStreaming) return;
    const t = setTimeout(() => {
      if (userInterruptedRef.current) return;
      scrollToBottom();
    }, 60);
    return () => clearTimeout(t);
  }, [messages, isStreaming]);

  const handleMessageListScroll = () => {
    const el = messageListRef.current;
    if (!el) return;

    // 更新滚动到底部按钮的显示状态
    setShowScrollButton(!isNearBottom(el));

    if (isStreaming) {
      const top = el.scrollTop;
      const last = lastScrollTopRef.current;
      lastScrollTopRef.current = top;
      if (isNearBottom(el)) {
        userInterruptedRef.current = false;
        return;
      }
      // 只在"用户真实手势导致的上滑"时才中断自动滚动，避免移动端键盘/地址栏/回流引起的误判
      const recentUserGesture = Date.now() - lastUserScrollAtRef.current < 800;
      const moved = Math.abs(top - last) > 2;
      if (recentUserGesture && moved) userInterruptedRef.current = true;
    }
  };

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    let touchStartY = 0;
    let touchStartScrollTop = 0;
    const markUserGesture = () => {
      lastUserScrollAtRef.current = Date.now();
    };
    // 记录触摸开始时的位置和滚动位置
    const handleTouchStart = (e) => {
      lastUserScrollAtRef.current = Date.now();
      touchStartY = e.touches?.[0]?.clientY;
      touchStartScrollTop = el.scrollTop;
    };
    // 移动端触摸滑动时：检测向上滑动意图（手指向下移动 = 内容向上滚动）
    const handleTouchMove = (e) => {
      lastUserScrollAtRef.current = Date.now();
      if (!isStreamingRef.current) return;
      const currentY = e.touches?.[0]?.clientY;
      const deltaY = currentY - touchStartY;
      // deltaY > 0 表示手指向下移动，即用户想向上滚动查看历史
      // 同时检测 scrollTop 是否减少或用户意图明显（移动超过 10px）
      if (deltaY > 10 || el.scrollTop < touchStartScrollTop - 5) {
        userInterruptedRef.current = true;
      }
    };
    // 电脑端滚轮向上滚动时，直接标记为用户中断
    const handleWheel = (e) => {
      lastUserScrollAtRef.current = Date.now();
      // deltaY < 0 表示向上滚动
      if (isStreamingRef.current && e.deltaY < 0) {
        userInterruptedRef.current = true;
      }
    };
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("mousedown", markUserGesture);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", markUserGesture);
    };
  }, []);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      if (!isStreamingRef.current) return;
      if (userInterruptedRef.current) return;
      scrollToBottom();
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    setAuthLoading(true);
    const endpoint =
      authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { email, password, confirmPassword };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success || data.user) {
        stopOngoingChatWork();
        hasRestoredConversationRef.current = false;
        setUser(data.user);
        setShowAuthModal(false);
        setAuthMode("login");
        setSettingsError(null);
        setPassword("");
        setConfirmPassword("");
        toast.success(authMode === "login" ? "登录成功" : "注册成功");
        fetchConversations();
        fetchActiveRuns();
        fetchSettings();
      } else {
        toast.error(data.error);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/me", { method: "DELETE" });
    stopOngoingChatWork();
    hasRestoredConversationRef.current = false;
    setUser(null);
    setMessages([]);
    setConversations([]);
    setActiveRuns([]);
    setCurrentConversationId(null);
    setSettingsError(null);
    // 清除登录表单敏感信息
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowAuthModal(true);
    setShowProfileModal(false);
  };

  const loadConversation = async (id, options = {}) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setMessages([]); // 先清空消息，显示加载动画
      if (window.innerWidth < 768) setSidebarOpen(false); // 移动端立即折叠侧边栏
    }
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (res.status === 401) {
        handleAuthExpired();
        throw new Error("登录已过期，请重新登录");
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.status === 404) {
        setConversations((prev) => prev.filter((conv) => conv._id !== id));
        if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
        }
      }
      if (!res.ok) throw new Error(data?.error || "加载会话失败");
      if (data.conversation) {
        if (silent && currentConversationIdRef.current && currentConversationIdRef.current !== id) {
          return;
        }
        userInterruptedRef.current = false;
        setMessages((prev) => {
          const serverMessages = Array.isArray(data.conversation.messages) ? data.conversation.messages : [];
          return silent
            ? mergeConversationMessages(serverMessages, prev)
            : decorateConversationMessages(serverMessages);
        });
        setCurrentConversationId(id);

        // 获取对话的模型和 provider
        const conversationModelConfig = CHAT_MODELS.find((m) => m.id === normalizeModelId(data.conversation.model));
        const conversationProvider = conversationModelConfig?.provider;
        const currentProvider = currentModelConfig?.provider;

        // 铁律：根据对话的 provider 强制切换模型
        // - Council 对话进入后，如果当前不是 Council，强制切为 Council
        // - Vectaix 对话进入后，如果当前不是 Vectaix，强制变为 Agent
        // - Gemini 对话进入后，如果当前不是 Gemini 模型，强制变为 Flash
        // - Claude 对话进入后，如果当前不是 Claude 模型，强制变为 Sonnet
        // - OpenAI 对话进入后，如果当前不是 OpenAI 模型，强制变为 GPT
        // - Seed 对话进入后，如果当前不是 Seed 模型，强制变为 Seed
        // - DeepSeek 对话进入后，如果当前不是 DeepSeek 模型，强制变为 DeepSeek
        let targetModel = model; // 默认保持当前模型
        if (conversationProvider === "council" && currentProvider !== "council") {
          targetModel = COUNCIL_MODEL_ID;
        } else if (conversationProvider === "vectaix" && currentProvider !== "vectaix") {
          targetModel = AGENT_MODEL_ID;
        } else if (conversationProvider === "gemini" && currentProvider !== "gemini") {
          targetModel = GEMINI_FLASH_MODEL;
        } else if (conversationProvider === "claude" && currentProvider !== "claude") {
          targetModel = CLAUDE_SONNET_MODEL;
        } else if (conversationProvider === "openai" && currentProvider !== "openai") {
          targetModel = OPENAI_PRIMARY_MODEL;
        } else if (conversationProvider === "seed" && currentProvider !== "seed") {
          targetModel = SEED_MODEL_ID;
        } else if (conversationProvider === "deepseek" && currentProvider !== "deepseek") {
          targetModel = DEEPSEEK_REASONER_MODEL;
        } else if (conversationProvider === currentProvider) {
          // provider 相同，保持当前模型不变
          targetModel = model;
        }

        if (targetModel !== model) {
          setModel(targetModel);
          lastTextModelRef.current = targetModel;
        }

        // 只恢复仍然保留在前端里的设置
        if (conversationProvider !== "council") {
          const settings = data.conversation.settings && typeof data.conversation.settings === "object"
            ? data.conversation.settings
            : {};
          if (typeof settings.webSearch === "boolean") {
            setWebSearch(settings.webSearch);
          }
          // activePromptId：优先使用对话存储的值，但需验证该提示词是否仍存在
          if (settings.activePromptId !== undefined) {
            const promptExists = systemPrompts.some(
              (p) => String(p?._id) === String(settings.activePromptId)
            );
            if (promptExists) {
              setActivePromptId(settings.activePromptId);
            } else {
              // 提示词已删除，回到“无”
              setActivePromptId(null);
            }
          }
        }
      }
    } catch (e) {
      if (!silent) {
        toast.error(`加载会话失败：${e?.message}`);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  // 同步对话参数到数据库（防抖，累积多个设置变更）
  const syncConversationSettings = (settingsUpdate) => {
    if (!currentConversationId || isCouncilModel(model)) return;
    // 如果切换了对话，清空之前的待同步设置（避免跨对话污染）
    if (pendingConversationIdRef.current && pendingConversationIdRef.current !== currentConversationId) {
      pendingSettingsRef.current = {};
      if (syncSettingsTimeoutRef.current) {
        clearTimeout(syncSettingsTimeoutRef.current);
        syncSettingsTimeoutRef.current = null;
      }
    }
    pendingConversationIdRef.current = currentConversationId;
    // 累积设置变更，而不是只保留最后一个
    pendingSettingsRef.current = { ...pendingSettingsRef.current, ...settingsUpdate };
    if (syncSettingsTimeoutRef.current) clearTimeout(syncSettingsTimeoutRef.current);
    syncSettingsTimeoutRef.current = setTimeout(async () => {
      const toSync = pendingSettingsRef.current;
      const targetId = pendingConversationIdRef.current;
      pendingSettingsRef.current = {};
      pendingConversationIdRef.current = null;
      if (!targetId) return;
      try {
        await fetch(`/api/conversations/${targetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: toSync }),
        });
      } catch { }
    }, 500);
  };

  const deleteConversation = async (id, e) => {
    e?.stopPropagation?.();
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c._id !== id));
      setActiveRuns((prev) => prev.filter((run) => run?.conversationId !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch { }
  };

  const startNewChat = () => {
    userInterruptedRef.current = false;
    stopOngoingChatWork();
    setCurrentConversationId(null);
    setMessages([]);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const requestModelChange = (nextModel) => {
    if (loading || messages.some((m) => m.isStreaming)) return;

    const currentProvider = currentModelConfig?.provider;
    const nextModelConfig = CHAT_MODELS.find((m) => m.id === nextModel);
    const nextProvider = nextModelConfig?.provider;

    // 如果有对话历史且 provider 不同，提示用户需要新建对话
    if (messages.length > 0 && currentProvider && nextProvider && currentProvider !== nextProvider) {
      const providerNames = { council: "Council", vectaix: "Vectaix", gemini: "Gemini", claude: "Claude", openai: "OpenAI", seed: "Seed", deepseek: "DeepSeek" };
      setConfirmModalConfig({
        title: "切换模型",
        message: `切换到 ${providerNames[nextProvider]} 模型需要新建对话。\n当前对话使用的是 ${providerNames[currentProvider]} 模型，无法在不同类型模型间继续对话。\n\n是否新建对话并切换模型？`,
        onConfirm: () => {
          userInterruptedRef.current = false;
          setCurrentConversationId(null);
          setMessages([]);
          setModel(nextModel);
          const rememberedPromptId = activePromptIds?.[nextModel];
          setActivePromptId(rememberedPromptId);
          lastTextModelRef.current = nextModel;
        }
      });
      setShowConfirmModal(true);
      return;
    }

    setModel(nextModel);
    const rememberedPromptId = activePromptIds?.[nextModel];
    if (rememberedPromptId != null) setActivePromptId(rememberedPromptId);
    lastTextModelRef.current = nextModel;
  };

  const renameConversation = async (id, newTitle) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      setConversations((prev) =>
        prev.map((c) => (c._id === id ? { ...c, title: newTitle } : c))
      );
    } catch { }
  };

  const togglePinConversation = async (id, nextPinned) => {
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      setConversations((prev) => {
        const next = prev.map((c) =>
          c._id === id ? { ...c, pinned: nextPinned, updatedAt: new Date().toISOString() } : c
        );
        return sortConversations(next);
      });
    } catch { }
  };

  const buildDuplicateTitle = (title) => {
    const sourceTitle = typeof title === "string" && title.trim() ? title.trim() : "新对话";
    const baseTitle = `${sourceTitle}（副本）`;
    const existingTitles = new Set(
      conversations
        .map((conv) => (typeof conv?.title === "string" ? conv.title.trim() : ""))
        .filter(Boolean)
    );
    if (!existingTitles.has(baseTitle)) return baseTitle;

    let index = 2;
    while (existingTitles.has(`${sourceTitle}（副本 ${index}）`)) {
      index += 1;
    }
    return `${sourceTitle}（副本 ${index}）`;
  };

  const duplicateConversation = async (id) => {
    try {
      const sourceRes = await fetch(`/api/conversations/${id}`);
      if (sourceRes.status === 401) {
        handleAuthExpired();
        return;
      }

      let sourceData = null;
      try {
        sourceData = await sourceRes.json();
      } catch {
        sourceData = null;
      }

      if (!sourceRes.ok) {
        throw new Error(sourceData?.error || "读取话题失败");
      }

      const sourceConversation = sourceData?.conversation;
      if (!sourceConversation) {
        throw new Error("未找到要复制的话题");
      }

      if (sourceConversation.model === AGENT_MODEL_ID || isCouncilModel(sourceConversation.model)) {
        return;
      }

      const createRes = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: buildDuplicateTitle(sourceConversation.title),
          model: sourceConversation.model,
          messages: Array.isArray(sourceConversation.messages) ? sourceConversation.messages : [],
          settings: sourceConversation.settings && typeof sourceConversation.settings === "object"
            ? sourceConversation.settings
            : undefined,
          pinned: false,
        }),
      });

      if (createRes.status === 401) {
        handleAuthExpired();
        return;
      }

      let createData = null;
      try {
        createData = await createRes.json();
      } catch {
        createData = null;
      }

      if (!createRes.ok) {
        throw new Error(createData?.error || "复制话题失败");
      }

      const duplicatedConversation = createData?.conversation;
      if (!duplicatedConversation?._id) {
        throw new Error("复制结果异常");
      }

      setCurrentConversationId(duplicatedConversation._id);
      setMessages(Array.isArray(duplicatedConversation.messages) ? duplicatedConversation.messages : []);

      if (typeof duplicatedConversation.model === "string" && duplicatedConversation.model) {
        setModel(duplicatedConversation.model);
        lastTextModelRef.current = duplicatedConversation.model;
      }

      const nextSettings = duplicatedConversation.settings && typeof duplicatedConversation.settings === "object"
        ? duplicatedConversation.settings
        : {};
      if (typeof nextSettings.webSearch === "boolean") {
        setWebSearch(nextSettings.webSearch);
      }
      if (nextSettings.activePromptId !== undefined) {
        const promptExists = systemPrompts.some(
          (prompt) => String(prompt?._id) === String(nextSettings.activePromptId)
        );
        setActivePromptId(promptExists ? nextSettings.activePromptId : null);
      }

      await fetchConversations();
      toast.success("已复制话题");
      if (window.innerWidth < 768) setSidebarOpen(false);
    } catch (error) {
      toast.error(error?.message || "复制话题失败");
    }
  };

  const updateThemeMode = (mode) => {
    setThemeMode(mode);
  };
  const updateFontSize = (size) => {
    setFontSize(size);
  };
  return (
    <>
      {showAuthModal ? (
        <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} loading={authLoading} />
      ) : (
        <ChatLayout
          user={user}
          isAdmin={!!user?.isAdmin}
          isSettingsReady={isSettingsReady}
          showProfileModal={showProfileModal}
          onCloseProfile={() => setShowProfileModal(false)}
          themeMode={themeMode}
          fontSize={fontSize}
          onThemeModeChange={updateThemeMode}
          onFontSizeChange={updateFontSize}
          completionSoundVolume={completionSoundVolume}
          onCompletionSoundVolumeChange={setCompletionSoundVolume}
          sidebarOpen={sidebarOpen}
          conversations={conversations}
          currentConversationId={currentConversationId}
          onStartNewChat={startNewChat}
          onLoadConversation={loadConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          onTogglePinConversation={togglePinConversation}
          onDuplicateConversation={duplicateConversation}
          onOpenProfile={() => setShowProfileModal(true)}
          onLogout={handleLogout}
          onCloseSidebar={() => setSidebarOpen(false)}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          messages={messages}
          loading={loading}
          chatEndRef={chatEndRef}
          messageListRef={messageListRef}
          onMessageListScroll={handleMessageListScroll}
          showScrollButton={showScrollButton}
          onScrollToBottom={scrollToBottom}
          editingMsgIndex={editingMsgIndex}
          editingContent={editingContent}
          editingImageAction={editingImageAction}
          editingImage={editingImage}
          fontSizeClass={FONT_SIZE_CLASSES[fontSize]}
          onEditingContentChange={setEditingContent}
          onEditingImageSelect={actions.onEditingImageSelect}
          onEditingImageRemove={actions.onEditingImageRemove}
          onEditingImageKeep={actions.onEditingImageKeep}
          onCancelEdit={actions.cancelEdit}
          onSubmitEdit={actions.submitEditAndRegenerate}
          onCopy={actions.copyMessage}
          onDeleteModelMessage={actions.deleteModelMessage}
          onDeleteUserMessage={actions.deleteUserMessage}
          onRegenerateModelMessage={actions.regenerateModelMessage}
          onContinueAgentRun={actions.continueAgentRun}
          onApproveAgentRun={actions.approveAgentRun}
          onRejectAgentRun={actions.rejectAgentRun}
          onStartEdit={actions.startEdit}
          userAvatar={avatar}
          onAvatarChange={setAvatar}
          composerProps={{
            loading,
            isStreaming,
            isWaitingForAI: loading && messages.length > 0,
            model,
            modelReady: isSettingsReady,
            onModelChange: requestModelChange,
            messages,
            contextWindow: currentModelConfig?.contextWindow,
            historyLimit,
            webSearch,
            setWebSearch: (v) => {
              setWebSearch(v);
              syncConversationSettings({ webSearch: v });
            },
            systemPrompts,
            activePromptIds,
            setActivePromptIds,
            activePromptId,
            setActivePromptId,
            onAddPrompt: addPrompt,
            onDeletePrompt: deletePrompt,
            onUpdatePrompt: updatePrompt,
            onSend: actions.handleSendFromComposer,
            onStop: actions.stopStreaming,
            prefill: composerPrefill,
          }}
        />
      )}
      <ConfirmModal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={() => {
          confirmModalConfig?.onConfirm();
          setShowConfirmModal(false);
        }}
        title={confirmModalConfig?.title}
        message={confirmModalConfig?.message}
        confirmText="确定"
        cancelText="取消"
      />
    </>
  );
}
