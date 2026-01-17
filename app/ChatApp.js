"use client";
import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat } from "./lib/chatClient";
import { useThemeMode } from "./lib/useThemeMode";
import { useUserSettings } from "./lib/useUserSettings";
import { CHAT_MODELS } from "./components/ChatModels";
import AuthModal from "./components/AuthModal";
import ChatLayout from "./components/ChatLayout";
import SettingsErrorView from "./components/SettingsErrorView";

// Simple unique id generator
let msgIdCounter = 0;
const generateMsgId = () => `msg_${Date.now()}_${++msgIdCounter}`;

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };

export default function ChatApp() {
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const mediaResolution = "media_resolution_high";
  const { model, setModel, thinkingLevels, setThinkingLevels, historyLimit, setHistoryLimit, maxTokens, setMaxTokens, budgetTokens, setBudgetTokens, webSearch, setWebSearch, systemPrompts, activePromptIds, setActivePromptIds, activePromptId, setActivePromptId, themeMode, setThemeMode, fontSize, setFontSize, settingsError, setSettingsError, fetchSettings, addPrompt, deletePrompt, updatePrompt } = useUserSettings();
  const { isDark } = useThemeMode(themeMode);
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
    const markUserGesture = () => {
      lastUserScrollAtRef.current = Date.now();
    };
    // 移动端触摸滑动时，如果不在底部则直接标记为用户中断
    const handleTouchMove = () => {
      lastUserScrollAtRef.current = Date.now();
      if (isStreamingRef.current && !isNearBottom(el)) {
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
    el.addEventListener("touchstart", markUserGesture, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("mousedown", markUserGesture);
    return () => {
      el.removeEventListener("touchstart", markUserGesture);
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
      fetchConversations();
      fetchSettings(); // 只获取系统提示词
    } else {
      alert(data.error);
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
        setMaxTokens(settings.maxTokens ?? 65536);
        setBudgetTokens(settings.budgetTokens ?? 32768);
        // activePromptId：优先使用对话存储的值
        if (settings.activePromptId !== undefined) {
          setActivePromptId(settings.activePromptId);
        }
      }
    } catch (e) {
      console.error(e); alert(e?.message || "会话数据不兼容");
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
      const confirmed = window.confirm(
        `切换到 ${providerNames[nextProvider] || nextProvider} 模型需要新建对话。\n当前对话使用的是 ${providerNames[currentProvider] || currentProvider} 模型，无法在不同类型模型间继续对话。\n\n是否新建对话并切换模型？`
      );
      if (!confirmed) return;
      // 新建对话
      userInterruptedRef.current = false;
      setCurrentConversationId(null);
      setMessages([]);
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

  const copyMessage = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (e) {
      console.error("复制失败", e);
    }
  };

  const syncConversationMessages = async (nextMessages) => {
    if (!currentConversationId) return;
    try {
      await fetch(`/api/conversations/${currentConversationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const deleteModelMessage = async (index) => {
    const nextMessages = messages.filter((_, i) => i !== index);
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const deleteUserMessage = async (index) => {
    const nextMessages = messages.filter(
      (_, i) => i !== index && i !== index + 1,
    );
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const stopStreaming = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    setLoading(false);
    setMessages((prev) => prev
      .filter((m) => !m.isStreaming || (m.content || "").trim() || (m.thought || "").trim())
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  const isHttpUrl = (src) => typeof src === "string" && /^https?:\/\//i.test(src);
  const isDataImageUrl = (src) => typeof src === "string" && /^data:image\//i.test(src);

  const getMessageImageSrc = (msg) => {
    if (msg && typeof msg.image === "string" && msg.image) return msg.image;
    if (Array.isArray(msg?.parts)) {
      for (const p of msg.parts) {
        const url = p?.inlineData?.url;
        if (typeof url === "string" && url) return url;
      }
    }
    return null;
  };

  const onEditingImageSelect = (img) => {
    setEditingImageAction("new");
    setEditingImage(img || null);
  };

  const onEditingImageRemove = () => {
    setEditingImageAction("remove");
    setEditingImage(null);
  };

  const onEditingImageKeep = () => {
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const handleSendFromComposer = async ({ text, images }) => {
    if ((!text && (!images || images.length === 0)) || loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;

    // 发送消息时重置滚动中断标记，确保自动滚动到底部
    userInterruptedRef.current = false;

    // 获取第一张图片的预览（如有），用于显示
    const firstImagePreview = images?.[0]?.preview || null;

    const userMsg = {
      id: generateMsgId(),
      role: "user",
      content: text,
      type: "text",
      image: firstImagePreview,
      images: images?.map((img) => img.preview) || [],
    };

    const historyBeforeUser = messages;
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    try {
      // 上传所有图片
      const imageUrls = [];
      if (images && images.length > 0) {
        for (const image of images) {
          if (image?.file) {
            const blob = await upload(image.file.name, image.file, {
              access: "public",
              handleUploadUrl: "/api/upload",
            });
            imageUrls.push(blob.url);
          }
        }
      }

      // 将本地预览 dataURL 替换为可持久化的 Blob URL
      if (imageUrls.length > 0) {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const m = next[i];
            if (m?.role === "user" && m?.id === userMsg.id) {
              next[i] = {
                ...m,
                image: imageUrls[0] || null,
                images: imageUrls,
              };
              break;
            }
          }
          return next;
        });
      }

      const config = buildChatConfig({
        model,
        thinkingLevel: thinkingLevels?.[model],
        mediaResolution,
        systemPrompts,
        activePromptId,
        imageUrl: imageUrls[0] || null,
        imageUrls: imageUrls.length > 0 ? imageUrls : null,
        maxTokens,
        budgetTokens,
        webSearch: (model?.startsWith("claude-") || model?.startsWith("gpt-")) ? webSearch : false,
      });

      await runChat({
        prompt: text,
        historyMessages: historyBeforeUser,
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading, signal: (chatAbortRef.current = new AbortController()).signal,
        provider: currentModelConfig?.provider,
        settings: !currentConversationId ? {
          thinkingLevel: thinkingLevels?.[model] || null,
          historyLimit,
          maxTokens,
          budgetTokens,
          activePromptId: activePromptId != null ? String(activePromptId) : null,
        } : undefined,
      });
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { id: generateMsgId(), role: "model", content: "Error: " + err.message, type: "error" },
      ]);
      setLoading(false);
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const regenerateModelMessage = async (index) => {
    if (loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    const userMsgIndex = index - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex]?.role !== "user") {
      chatRequestLockRef.current = false;
      return;
    }

    // 重新生成时重置滚动中断标记
    userInterruptedRef.current = false;

    const userMsg = messages[userMsgIndex];
    const historyWithUser = messages.slice(0, index);
    setMessages(historyWithUser);

    const config = buildChatConfig({
      model,
      thinkingLevel: thinkingLevels?.[model],
      mediaResolution,
      systemPrompts,
      activePromptId,
      maxTokens,
      budgetTokens,
      webSearch: (model?.startsWith("claude-") || model?.startsWith("gpt-")) ? webSearch : false,
    });

    try {
      await runChat({
        prompt: userMsg.content,
        historyMessages: historyWithUser.slice(0, -1),
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        // 图片模型也必须走 regenerate：否则服务端会当作"新用户消息"追加，历史图片/签名带不上
        mode: "regenerate",
        messagesForRegenerate: historyWithUser,
        provider: currentModelConfig?.provider,
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const startEdit = (index, msg) => {
    if (loading) return;
    setEditingMsgIndex(index);
    setEditingContent(msg?.content || "");
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const cancelEdit = () => {
    setEditingMsgIndex(null);
    setEditingContent("");
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const submitEditAndRegenerate = async (index) => {
    if (loading || editingMsgIndex === null || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    const newContent = editingContent.trim();
    const oldMsg = messages[index];
    const existingImageSrc = getMessageImageSrc(oldMsg);
    const canKeepExistingImage = isHttpUrl(existingImageSrc) || isDataImageUrl(existingImageSrc);
    const hasImageAfterEdit =
      (editingImageAction === "new" && editingImage?.file) ||
      (editingImageAction === "keep" && canKeepExistingImage);
    if (!newContent && !hasImageAfterEdit) {
      chatRequestLockRef.current = false;
      return;
    }

    // 编辑提交时重置滚动中断标记
    userInterruptedRef.current = false;

    // 提前设置 loading 状态，避免图片上传期间 UI 无反馈导致"卡顿"感
    setLoading(true);

    const nextMessages = messages.slice(0, index);
    const updatedMsg = { ...oldMsg, content: newContent };

    let nextImageUrl = null;
    let nextMimeType = null;
    try {
      if (editingImageAction === "remove") {
        nextImageUrl = null;
      } else if (editingImageAction === "new" && editingImage?.file) {
        const blob = await upload(editingImage.file.name, editingImage.file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });
        nextImageUrl = blob.url;
        nextMimeType = editingImage.mimeType || editingImage.file.type || null;
      } else if (editingImageAction === "keep") {
        if (typeof oldMsg?.mimeType === "string" && oldMsg.mimeType) nextMimeType = oldMsg.mimeType;

        if (isHttpUrl(existingImageSrc)) {
          nextImageUrl = existingImageSrc;
        } else if (isDataImageUrl(existingImageSrc)) {
          // 兼容：历史消息里如果残留 data:image（本地预览），这里自动上传到 Blob，避免提交后“静默丢图”
          const resp = await fetch(existingImageSrc);
          const b = await resp.blob();
          const mime = b.type || nextMimeType || "image/png";
          const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
          const file = new File([b], `edit-${Date.now()}.${ext}`, { type: mime });
          const uploaded = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/upload",
          });
          nextImageUrl = uploaded.url;
          nextMimeType = mime;
        } else {
          nextImageUrl = null;
        }
      }

      const parts = [];
      if (newContent) parts.push({ text: newContent });
      if (nextImageUrl) {
        const inlineData = { url: nextImageUrl };
        if (nextMimeType) inlineData.mimeType = nextMimeType;
        parts.push({ inlineData });
      }

      if (parts.length > 0) updatedMsg.parts = parts;
      else delete updatedMsg.parts;

      if (nextImageUrl) updatedMsg.image = nextImageUrl;
      else delete updatedMsg.image;

      if (nextMimeType) updatedMsg.mimeType = nextMimeType;
      else if (editingImageAction === "remove") delete updatedMsg.mimeType;
    } catch (e) {
      console.error(e);
      chatRequestLockRef.current = false;
      setLoading(false);
      setMessages((prev) => [
        ...prev,
        { id: generateMsgId(), role: "model", content: "Error: " + (e?.message || "图片处理失败"), type: "error" },
      ]);
      return;
    }
    nextMessages.push(updatedMsg);
    setMessages(nextMessages);
    cancelEdit();

    const config = buildChatConfig({
      model,
      thinkingLevel: thinkingLevels?.[model],
      mediaResolution,
      systemPrompts,
      activePromptId,
      maxTokens,
      budgetTokens,
      webSearch: (model?.startsWith("claude-") || model?.startsWith("gpt-")) ? webSearch : false,
    });

    try {
      await runChat({
        prompt: newContent,
        historyMessages: nextMessages.slice(0, -1),
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        // 图片模型也要走 regenerate，否则编辑后的"图片对话上下文"会丢
        mode: "regenerate",
        messagesForRegenerate: nextMessages,
        provider: currentModelConfig?.provider,
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const updateThemeMode = (mode) => {
    setThemeMode(mode);
  };

  const updateFontSize = (size) => {
    setFontSize(size);
  };
  if (showAuthModal) {
    return (
      <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} />
    );
  }

  if (settingsError) {
    return <SettingsErrorView isDark={isDark} settingsError={settingsError} onLogout={handleLogout} />;
  }
  return <ChatLayout isDark={isDark} user={user} showProfileModal={showProfileModal} onCloseProfile={() => setShowProfileModal(false)} themeMode={themeMode} fontSize={fontSize} onThemeModeChange={updateThemeMode} onFontSizeChange={updateFontSize} sidebarOpen={sidebarOpen} conversations={conversations} currentConversationId={currentConversationId} onStartNewChat={startNewChat} onLoadConversation={loadConversation} onDeleteConversation={deleteConversation} onRenameConversation={renameConversation} onOpenProfile={() => setShowProfileModal(true)} onLogout={handleLogout} onCloseSidebar={() => setSidebarOpen(false)} onToggleSidebar={() => setSidebarOpen((v) => !v)} messages={messages} loading={loading} chatEndRef={chatEndRef} messageListRef={messageListRef} onMessageListScroll={handleMessageListScroll} showScrollButton={showScrollButton} onScrollToBottom={scrollToBottom} editingMsgIndex={editingMsgIndex} editingContent={editingContent} editingImageAction={editingImageAction} editingImage={editingImage} fontSizeClass={FONT_SIZE_CLASSES[fontSize] || ""} onEditingContentChange={setEditingContent} onEditingImageSelect={onEditingImageSelect} onEditingImageRemove={onEditingImageRemove} onEditingImageKeep={onEditingImageKeep} onCancelEdit={cancelEdit} onSubmitEdit={submitEditAndRegenerate} onCopy={copyMessage} onDeleteModelMessage={deleteModelMessage} onDeleteUserMessage={deleteUserMessage} onRegenerateModelMessage={regenerateModelMessage} onStartEdit={startEdit} composerProps={{ loading, isStreaming, isWaitingForAI: loading && messages.length > 0, model, onModelChange: requestModelChange, thinkingLevel: thinkingLevels?.[model], setThinkingLevel: (v) => { setThinkingLevels((prev) => ({ ...(prev || {}), [model]: v })); syncConversationSettings({ thinkingLevel: v }); }, historyLimit, setHistoryLimit: (v) => { setHistoryLimit(v); syncConversationSettings({ historyLimit: v }); }, maxTokens, setMaxTokens: (v) => { setMaxTokens(v); syncConversationSettings({ maxTokens: v }); }, budgetTokens, setBudgetTokens: (v) => { setBudgetTokens(v); syncConversationSettings({ budgetTokens: v }); }, webSearch, setWebSearch, systemPrompts, activePromptIds, setActivePromptIds, activePromptId, setActivePromptId: (v) => { setActivePromptId(v); syncConversationSettings({ activePromptId: v != null ? String(v) : null }); }, onAddPrompt: addPrompt, onDeletePrompt: deletePrompt, onUpdatePrompt: updatePrompt, onSend: handleSendFromComposer, onStop: stopStreaming }} />;
}
