"use client";
import { useEffect, useRef, useState } from "react";
import { createChatAppActions } from "./lib/chatAppActions";
import { useThemeMode } from "./lib/useThemeMode";
import { useUserSettings } from "./lib/useUserSettings";
import { useToast } from "./components/ToastProvider";
import { CHAT_MODELS } from "./components/ChatModels";
import AuthModal from "./components/AuthModal";
import ConfirmModal from "./components/ConfirmModal";
import ChatLayout from "./components/ChatLayout";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };

export default function ChatApp() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const mediaResolution = "media_resolution_high";
  const { model, setModel, thinkingLevels, setThinkingLevels, historyLimit, setHistoryLimit, maxTokens, setMaxTokens, budgetTokens, setBudgetTokens, webSearch, setWebSearch, systemPrompts, activePromptIds, setActivePromptIds, activePromptId, setActivePromptId, themeMode, setThemeMode, fontSize, setFontSize, completionSoundVolume, setCompletionSoundVolume, settingsError, setSettingsError, fetchSettings, addPrompt, deletePrompt, updatePrompt, avatar, setAvatar } = useUserSettings();
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

  const chatEndRef = useRef(null);
  const messageListRef = useRef(null);
  const userInterruptedRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);
  const scrollRafRef = useRef(0);
  const chatAbortRef = useRef(null);
  const chatRequestLockRef = useRef(false);
  const lastTextModelRef = useRef("gemini-3-flash-preview");
  const isStreamingRef = useRef(false);
  const isStreaming = messages.some((m) => m.isStreaming);
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
          fetchSettings(); // 只获取系统提示词
        } else {
          setShowAuthModal(true);
        }
      })
      .catch((err) => {
        console.error("Auth check failed:", err);
        setShowAuthModal(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup: abort pending requests on unmount
  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      if (data.conversations) setConversations(data.conversations);
    } catch (e) {
      console.error(e);
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
    budgetTokens,
    webSearch,
    historyLimit,
    currentConversationId,
    setCurrentConversationId,
    fetchConversations,
    currentModelConfig,
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
  });

  useEffect(() => {
    if (!wasStreamingRef.current && isStreaming) {
      userInterruptedRef.current = false;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

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
      touchStartY = e.touches?.[0]?.clientY ?? 0;
      touchStartScrollTop = el.scrollTop;
    };
    // 移动端触摸滑动时：检测向上滑动意图（手指向下移动 = 内容向上滚动）
    const handleTouchMove = (e) => {
      lastUserScrollAtRef.current = Date.now();
      if (!isStreamingRef.current) return;
      const currentY = e.touches?.[0]?.clientY ?? 0;
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
    const endpoint =
      authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { email, password, confirmPassword };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success || data.user) {
      setUser(data.user);
      setShowAuthModal(false);
      toast.success(authMode === "login" ? "登录成功" : "注册成功");
      fetchConversations();
      fetchSettings();
    } else {
      toast.error(data.error || "登录失败，请重试");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/me", { method: "DELETE" });
    setUser(null);
    setMessages([]);
    setConversations([]);
    setCurrentConversationId(null);
    setSettingsError(null);
    // 清除登录表单敏感信息
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowAuthModal(true);
    setShowProfileModal(false);
  };

  const loadConversation = async (id) => {
    setLoading(true);
    setMessages([]); // 先清空消息，显示加载动画
    if (window.innerWidth < 768) setSidebarOpen(false); // 移动端立即折叠侧边栏
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || res.statusText);
      if (data.conversation) {
        const nextMessages = data.conversation.messages || [];
        userInterruptedRef.current = false;
        setMessages(nextMessages);
        setCurrentConversationId(id);

        // 获取对话的模型和 provider
        const conversationModel = data.conversation.model;
        const conversationModelConfig = CHAT_MODELS.find((m) => m.id === conversationModel);
        const conversationProvider = conversationModelConfig?.provider;
        const currentProvider = currentModelConfig?.provider;

        // 铁律：根据对话的 provider 强制切换模型
        // - Gemini 对话进入后，如果当前不是 Gemini 模型，强制变为 Flash
        // - Claude 对话进入后，如果当前不是 Claude 模型，强制变为 Sonnet
        // - OpenAI 对话进入后，如果当前不是 OpenAI 模型，强制变为 GPT
        let targetModel = model; // 默认保持当前模型
        if (conversationProvider === "gemini" && currentProvider !== "gemini") {
          targetModel = "gemini-3-flash-preview";
        } else if (conversationProvider === "claude" && currentProvider !== "claude") {
          targetModel = "claude-sonnet-4-5-20250929";
        } else if (conversationProvider === "openai" && currentProvider !== "openai") {
          targetModel = "gpt-5.2";
        } else if (conversationProvider === currentProvider) {
          // provider 相同，保持当前模型不变
          targetModel = model;
        }

        if (targetModel !== model) {
          setModel(targetModel);
          lastTextModelRef.current = targetModel;
        }

        // 恢复对话的参数设置（使用默认值填充缺失的字段）
        const settings = data.conversation.settings || {};
        // 思考级别：恢复对话存储的值
        if (settings.thinkingLevel !== undefined && conversationModel) {
          const defaultThinkingLevel = conversationModel.includes("gemini") ? "high" : null;
          setThinkingLevels((prev) => ({
            ...(prev || {}),
            [targetModel]: settings.thinkingLevel ?? defaultThinkingLevel
          }));
        }
        // 其他参数：使用对话设置，否则使用默认值
        setHistoryLimit(settings.historyLimit ?? 0);
        const maxTokensValue = settings.maxTokens ?? (conversationProvider === "openai" ? 128000 : 65536);
        const providerLimits = { claude: 64000, openai: 128000, gemini: 65536 };
        const maxAllowed = providerLimits[conversationProvider] || 65536;
        setMaxTokens(Math.min(maxTokensValue, maxAllowed));
        setBudgetTokens(settings.budgetTokens ?? 32768);
        // activePromptId：优先使用对话存储的值
        if (settings.activePromptId !== undefined) {
          setActivePromptId(settings.activePromptId);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error(`加载会话失败：${e?.message || "数据格式错误"}`);
    } finally {
      setLoading(false);
    }
  };

  // 同步对话参数到数据库（防抖，累积多个设置变更）
  const syncSettingsTimeoutRef = useRef(null);
  const pendingSettingsRef = useRef({});
  const pendingConversationIdRef = useRef(null);
  const syncConversationSettings = (settingsUpdate) => {
    if (!currentConversationId) return;
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
      } catch (err) {
        console.error("Failed to sync settings:", err);
      }
    }, 500);
  };

  const deleteConversation = async (id, e) => {
    e?.stopPropagation?.();
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startNewChat = () => {
    userInterruptedRef.current = false;
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
      const providerNames = { gemini: "Gemini", claude: "Claude", openai: "OpenAI" };
      setConfirmModalConfig({
        title: "切换模型",
        message: `切换到 ${providerNames[nextProvider] || nextProvider} 模型需要新建对话。\n当前对话使用的是 ${providerNames[currentProvider] || currentProvider} 模型，无法在不同类型模型间继续对话。\n\n是否新建对话并切换模型？`,
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
    } catch (err) {
      console.error(err);
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
        <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} />
      ) : (
        <ChatLayout
          user={user}
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
          fontSizeClass={FONT_SIZE_CLASSES[fontSize] || ""}
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
          onStartEdit={actions.startEdit}
          userAvatar={avatar}
          onAvatarChange={setAvatar}
          composerProps={{
            loading,
            isStreaming,
            isWaitingForAI: loading && messages.length > 0,
            model,
            onModelChange: requestModelChange,
            thinkingLevel: thinkingLevels?.[model],
            setThinkingLevel: (v) => {
              setThinkingLevels((prev) => ({ ...(prev || {}), [model]: v }));
              syncConversationSettings({ thinkingLevel: v });
            },
            historyLimit,
            setHistoryLimit: (v) => {
              setHistoryLimit(v);
              syncConversationSettings({ historyLimit: v });
            },
            maxTokens,
            setMaxTokens: (v) => {
              setMaxTokens(v);
              syncConversationSettings({ maxTokens: v });
            },
            budgetTokens,
            setBudgetTokens: (v) => {
              setBudgetTokens(v);
              syncConversationSettings({ budgetTokens: v });
            },
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
