"use client";
import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat } from "./lib/chatClient";
import { useThemeMode } from "./lib/useThemeMode";
import { useUserSettings } from "./lib/useUserSettings";
import AuthModal from "./components/AuthModal";
import ChatLayout from "./components/ChatLayout";
import SettingsErrorView from "./components/SettingsErrorView";
const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
const IMAGE_MODEL_ID = "gemini-3-pro-image-preview";
const isImageModel = (m) => m === IMAGE_MODEL_ID;
const isImageConversation = (msgs = []) => msgs.some((m) => m?.role === "model" && m.type === "parts");
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
  const { model, setModel, thinkingLevels, setThinkingLevels, historyLimit, setHistoryLimit, aspectRatio, setAspectRatio, imageSize, setImageSize, systemPrompts, activePromptIds, setActivePromptIds, activePromptId, setActivePromptId, themeMode, setThemeMode, fontSize, setFontSize, settingsError, setSettingsError, fetchSettings, saveSettings, addPrompt, deletePrompt, updatePrompt } = useUserSettings();
  const { isDark } = useThemeMode(themeMode);
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");

  const chatEndRef = useRef(null);
  const messageListRef = useRef(null);
  const userInterruptedRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);
  const scrollRafRef = useRef(0);
  const chatAbortRef = useRef(null);
  const lastTextModelRef = useRef("gemini-3-pro-preview");
  const [switchModelOpen, setSwitchModelOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState(null);
  const isStreaming = messages.some((m) => m.isStreaming);
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
          (async () => {
            const s = await fetchSettings();
            const nextModel = s?.model;
            if (typeof nextModel === "string" && !isImageModel(nextModel)) {
              lastTextModelRef.current = nextModel;
            }
          })();
        } else {
          setShowAuthModal(true);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (isStreaming) {
      const top = el.scrollTop;
      const last = lastScrollTopRef.current;
      lastScrollTopRef.current = top;
      if (isNearBottom(el)) {
        userInterruptedRef.current = false;
        return;
      }
      // 只在“用户真实手势导致的上滑”时才中断自动滚动，避免移动端键盘/地址栏/回流引起的误判
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
    el.addEventListener("touchstart", markUserGesture, { passive: true });
    el.addEventListener("touchmove", markUserGesture, { passive: true });
    el.addEventListener("wheel", markUserGesture, { passive: true });
    el.addEventListener("mousedown", markUserGesture);
    return () => {
      el.removeEventListener("touchstart", markUserGesture);
      el.removeEventListener("touchmove", markUserGesture);
      el.removeEventListener("wheel", markUserGesture);
      el.removeEventListener("mousedown", markUserGesture);
    };
  }, []);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      if (!isStreaming) return;
      if (userInterruptedRef.current) return;
      scrollToBottom();
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [isStreaming]);

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
      (async () => {
        const s = await fetchSettings();
        const nextModel = s?.model;
        if (typeof nextModel === "string" && !isImageModel(nextModel)) {
          lastTextModelRef.current = nextModel;
        }
      })();
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
    setShowAuthModal(true);
    setShowProfileModal(false);
  };

  const loadConversation = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || res.statusText);
      if (data.conversation) {
        const nextMessages = data.conversation.messages || [];
        userInterruptedRef.current = false;
        setMessages(nextMessages);
        setCurrentConversationId(id);
        const convIsImage = isImageConversation(nextMessages);
        if (convIsImage && model !== IMAGE_MODEL_ID) {
          setModel(IMAGE_MODEL_ID);
          const remembered = activePromptIds?.[IMAGE_MODEL_ID];
          if (remembered != null) setActivePromptId(remembered);
        }
        if (!convIsImage && model === IMAGE_MODEL_ID) {
          const nextModel = lastTextModelRef.current;
          setModel(nextModel);
          const remembered = activePromptIds?.[nextModel];
          if (remembered != null) setActivePromptId(remembered);
        }
        if (window.innerWidth < 768) setSidebarOpen(false);
      }
    } catch (e) {
      console.error(e); alert(e?.message || "会话数据不兼容");
    } finally {
      setLoading(false);
    }
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

    const hasConversation = Boolean(currentConversationId) || messages.length > 0;
    const currentIsImageConv = currentConversationId
      ? isImageConversation(messages)
      : isImageModel(model);
    const nextIsImage = isImageModel(nextModel);

    if (hasConversation && nextIsImage !== currentIsImageConv) {
      setPendingModel(nextModel);
      setSwitchModelOpen(true);
      return;
    }

    setModel(nextModel);
    const rememberedPromptId = activePromptIds?.[nextModel];
    if (rememberedPromptId != null) setActivePromptId(rememberedPromptId);
    if (!nextIsImage) lastTextModelRef.current = nextModel;
    saveSettings({ model: nextModel });
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
    setLoading(false);
    setMessages((prev) => prev
      .filter((m) => !m.isStreaming || (m.content || "").trim() || (m.thought || "").trim())
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  const handleSendFromComposer = async ({ text, image }) => {
    if ((!text && !image) || loading) return;

    // 发送消息时重置滚动中断标记，确保自动滚动到底部
    userInterruptedRef.current = false;

    const userMsg = {
      role: "user",
      content: text,
      type: "text",
      image: image ? image.preview : null,
    };

    const historyBeforeUser = messages;
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    try {
      let imageUrl = null;
      if (image?.file) {
        const blob = await upload(image.file.name, image.file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });
        imageUrl = blob.url;
      }

      const config = buildChatConfig({
        model,
        thinkingLevel: thinkingLevels?.[model],
        aspectRatio,
        imageSize,
        mediaResolution,
        systemPrompts,
        activePromptId,
        imageUrl,
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
      });
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "model", content: "Error: " + err.message, type: "error" },
      ]);
      setLoading(false);
    }
  };

  const regenerateModelMessage = async (index) => {
    if (loading) return;
    const userMsgIndex = index - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex]?.role !== "user") return;

    // 重新生成时重置滚动中断标记
    userInterruptedRef.current = false;

    const userMsg = messages[userMsgIndex];
    const historyWithUser = messages.slice(0, index);
    setMessages(historyWithUser);

    const config = buildChatConfig({
      model,
      thinkingLevel: thinkingLevels?.[model],
      aspectRatio,
      imageSize,
      mediaResolution,
      systemPrompts,
      activePromptId,
    });

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
      setLoading, signal: (chatAbortRef.current = new AbortController()).signal,
      ...(isImageModel(model) ? {} : { mode: "regenerate", messagesForRegenerate: historyWithUser }),
    });
  };

  const startEdit = (index, content) => {
    if (loading) return;
    setEditingMsgIndex(index);
    setEditingContent(content);
  };

  const cancelEdit = () => {
    setEditingMsgIndex(null);
    setEditingContent("");
  };

  const submitEditAndRegenerate = async (index) => {
    if (loading || editingMsgIndex === null) return;
    const newContent = editingContent.trim();
    if (!newContent) return;

    // 编辑提交时重置滚动中断标记
    userInterruptedRef.current = false;

    const nextMessages = messages.slice(0, index);
    const oldMsg = messages[index];
    // 同时更新 content 和 parts（如果有），否则气泡会显示旧的 parts 文本
    const updatedMsg = { ...oldMsg, content: newContent };
    if (Array.isArray(oldMsg.parts) && oldMsg.parts.length > 0) {
      // 保留图片等非文本 part，替换纯文本 part
      const hasNonText = oldMsg.parts.some((p) => p?.inlineData);
      if (hasNonText) {
        updatedMsg.parts = oldMsg.parts.map((p) =>
          p?.text != null && !p?.inlineData ? { ...p, text: newContent } : p
        );
      } else {
        updatedMsg.parts = [{ text: newContent }];
      }
    }
    nextMessages.push(updatedMsg);
    setMessages(nextMessages);
    cancelEdit();

    const config = buildChatConfig({
      model,
      thinkingLevel: thinkingLevels?.[model],
      aspectRatio,
      imageSize,
      mediaResolution,
      systemPrompts,
      activePromptId,
    });

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
      setLoading, signal: (chatAbortRef.current = new AbortController()).signal,
      ...(isImageModel(model) ? {} : { mode: "regenerate", messagesForRegenerate: nextMessages }),
    });
  };

  const updateThemeMode = (mode) => {
    setThemeMode(mode);
    saveSettings({ themeMode: mode });
  };

  const updateFontSize = (size) => {
    setFontSize(size);
    saveSettings({ fontSize: size });
  };
  if (showAuthModal) {
    return (
      <AuthModal authMode={authMode} email={email} password={password} confirmPassword={confirmPassword} onEmailChange={setEmail} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} onSubmit={handleAuth} onToggleMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))} />
    );
  }

  if (settingsError) {
    return <SettingsErrorView isDark={isDark} settingsError={settingsError} onLogout={handleLogout} />;
  }
  return <ChatLayout isDark={isDark} user={user} showProfileModal={showProfileModal} onCloseProfile={() => setShowProfileModal(false)} themeMode={themeMode} fontSize={fontSize} onThemeModeChange={updateThemeMode} onFontSizeChange={updateFontSize} switchModelOpen={switchModelOpen} onCloseSwitchModel={() => { setSwitchModelOpen(false); setPendingModel(null); }} onConfirmSwitchModel={() => { if (!pendingModel) return; startNewChat(); setModel(pendingModel); const rememberedPromptId = activePromptIds?.[pendingModel]; if (rememberedPromptId != null) setActivePromptId(rememberedPromptId); if (!isImageModel(pendingModel)) lastTextModelRef.current = pendingModel; saveSettings({ model: pendingModel }); }} sidebarOpen={sidebarOpen} conversations={conversations} currentConversationId={currentConversationId} onStartNewChat={startNewChat} onLoadConversation={loadConversation} onDeleteConversation={deleteConversation} onRenameConversation={renameConversation} onOpenProfile={() => setShowProfileModal(true)} onLogout={handleLogout} onCloseSidebar={() => setSidebarOpen(false)} onToggleSidebar={() => setSidebarOpen((v) => !v)} messages={messages} loading={loading} chatEndRef={chatEndRef} messageListRef={messageListRef} onMessageListScroll={handleMessageListScroll} editingMsgIndex={editingMsgIndex} editingContent={editingContent} fontSizeClass={FONT_SIZE_CLASSES[fontSize] || ""} onEditingContentChange={setEditingContent} onCancelEdit={cancelEdit} onSubmitEdit={submitEditAndRegenerate} onCopy={copyMessage} onDeleteModelMessage={deleteModelMessage} onDeleteUserMessage={deleteUserMessage} onRegenerateModelMessage={regenerateModelMessage} onStartEdit={startEdit} composerProps={{ loading, isStreaming, model, onModelChange: requestModelChange, thinkingLevel: thinkingLevels?.[model], setThinkingLevel: (v) => setThinkingLevels((prev) => ({ ...(prev || {}), [model]: v })), historyLimit, setHistoryLimit, aspectRatio, setAspectRatio, imageSize, setImageSize, systemPrompts, activePromptIds, setActivePromptIds, activePromptId, setActivePromptId, saveSettings, onAddPrompt: addPrompt, onDeletePrompt: deletePrompt, onUpdatePrompt: updatePrompt, onSend: handleSendFromComposer, onStop: stopStreaming }} />;
}
