"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat } from "./lib/chatClient";

import AuthModal from "./components/AuthModal";
import ChatHeader from "./components/ChatHeader";
import Composer from "./components/Composer";
import ConfirmModal from "./components/ConfirmModal";
import MessageList from "./components/MessageList";
import ProfileModal from "./components/ProfileModal";
import Sidebar from "./components/Sidebar";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };
const IMAGE_MODEL_ID = "gemini-3-pro-image-preview";
const isImageModel = (m) => m === IMAGE_MODEL_ID;
const isImageConversation = (msgs = []) =>
  msgs.some((m) => m?.role === "model" && (m.type === "parts" || m.type === "image"));

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
  const [model, setModel] = useState("gemini-3-pro-preview");
  const [thinkingLevel, setThinkingLevel] = useState("high");
  const [mediaResolution] = useState("media_resolution_high");
  const [historyLimit, setHistoryLimit] = useState(0);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptId, setActivePromptId] = useState(null);
  const [themeMode, setThemeMode] = useState("system"); // light, dark, system
  const [isDark, setIsDark] = useState(false);
  const [fontSize, setFontSize] = useState("medium"); // small, medium, large
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");

  const chatEndRef = useRef(null);
  const messageListRef = useRef(null);
  const userInterruptedRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const wasStreamingRef = useRef(false);
  const chatAbortRef = useRef(null);
  const lastTextModelRef = useRef("gemini-3-pro-preview");
  const [switchModelOpen, setSwitchModelOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState(null);
  const isStreaming = messages.some((m) => m.isStreaming);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.settings) {
        const nextModel = data.settings.model || "gemini-3-pro-preview";
        setModel(nextModel);
        if (!isImageModel(nextModel)) lastTextModelRef.current = nextModel;
        setThinkingLevel(data.settings.thinkingLevel || "high");
        setHistoryLimit(data.settings.historyLimit || 0);
        setAspectRatio(data.settings.aspectRatio || "16:9");
        setSystemPrompts(data.settings.systemPrompts || []);
        setActivePromptId(data.settings.activeSystemPromptId || null);
        setThemeMode(data.settings.themeMode || "system");
        setFontSize(data.settings.fontSize || "medium");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveSettings = async (updates) => {
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const updateTheme = () => {
      if (themeMode === "system") {
        setIsDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      } else {
        setIsDark(themeMode === "dark");
      }
    };

    updateTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (themeMode === "system") updateTheme();
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark-mode");
      document.body.classList.add("dark-mode");
      root.style.colorScheme = "dark";
      root.style.backgroundColor = "#18181b";
    } else {
      root.classList.remove("dark-mode");
      document.body.classList.remove("dark-mode");
      root.style.colorScheme = "light";
      root.style.backgroundColor = "#ffffff";
    }
  }, [isDark]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          fetchConversations();
          fetchSettings();
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
      const el = messageListRef.current;
      if (el) lastScrollTopRef.current = el.scrollTop;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (userInterruptedRef.current) return;
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    lastScrollTopRef.current = el.scrollTop;
  }, [messages]);

  const handleMessageListScroll = () => {
    const el = messageListRef.current;
    if (!el) return;
    const currentTop = el.scrollTop;
    const prevTop = lastScrollTopRef.current;
    if (isStreaming && currentTop < prevTop) {
      userInterruptedRef.current = true;
    }
    lastScrollTopRef.current = currentTop;
  };

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
      fetchSettings();
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
    setShowAuthModal(true);
    setShowProfileModal(false);
  };

  const loadConversation = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (data.conversation) {
        const nextMessages = data.conversation.messages || [];
        userInterruptedRef.current = false;
        setMessages(nextMessages);
        setCurrentConversationId(id);
        const convIsImage = isImageConversation(nextMessages);
        if (convIsImage && model !== IMAGE_MODEL_ID) setModel(IMAGE_MODEL_ID);
        if (!convIsImage && model === IMAGE_MODEL_ID) setModel(lastTextModelRef.current);
        if (window.innerWidth < 768) setSidebarOpen(false);
      }
    } catch (e) {
      console.error(e);
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
        thinkingLevel,
        aspectRatio,
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
      thinkingLevel,
      aspectRatio,
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
    nextMessages.push({ ...messages[index], content: newContent });
    setMessages(nextMessages);
    cancelEdit();

    const config = buildChatConfig({
      model,
      thinkingLevel,
      aspectRatio,
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
      <AuthModal
        authMode={authMode}
        email={email}
        password={password}
        confirmPassword={confirmPassword}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSubmit={handleAuth}
        onToggleMode={() =>
          setAuthMode((m) => (m === "login" ? "register" : "login"))
        }
      />
    );
  }

  return (
    <div
      className={`app-root flex font-sans overflow-hidden ${isDark ? "dark-mode" : "light-mode"}`}
    >
      <ProfileModal open={showProfileModal} onClose={() => setShowProfileModal(false)} user={user} themeMode={themeMode} fontSize={fontSize} onThemeModeChange={updateThemeMode} onFontSizeChange={updateFontSize} />
      <ConfirmModal open={switchModelOpen} onClose={() => { setSwitchModelOpen(false); setPendingModel(null); }} onConfirm={() => { if (!pendingModel) return; startNewChat(); setModel(pendingModel); if (!isImageModel(pendingModel)) lastTextModelRef.current = pendingModel; saveSettings({ model: pendingModel }); }} title="切换模型将新建对话" message="图片模型与快速/思考模型不能出现在同一个会话中。切换将新建对话，当前对话会保留在历史记录中。" confirmText="新建对话并切换" cancelText="取消" />
      <Sidebar isOpen={sidebarOpen} conversations={conversations} currentConversationId={currentConversationId} user={user} onStartNewChat={startNewChat} onLoadConversation={loadConversation} onDeleteConversation={deleteConversation} onRenameConversation={renameConversation} onOpenProfile={() => setShowProfileModal(true)} onLogout={handleLogout} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col w-full h-full relative">
        <ChatHeader onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <MessageList
          messages={messages}
          loading={loading}
          chatEndRef={chatEndRef}
          listRef={messageListRef}
          onScroll={handleMessageListScroll}
          editingMsgIndex={editingMsgIndex}
          editingContent={editingContent}
          fontSizeClass={FONT_SIZE_CLASSES[fontSize] || ""}
          onEditingContentChange={setEditingContent}
          onCancelEdit={cancelEdit}
          onSubmitEdit={submitEditAndRegenerate}
          onCopy={copyMessage}
          onDeleteModelMessage={deleteModelMessage}
          onDeleteUserMessage={deleteUserMessage}
          onRegenerateModelMessage={regenerateModelMessage}
          onStartEdit={startEdit}
        />
        <Composer loading={loading} isStreaming={isStreaming} model={model} onModelChange={requestModelChange} thinkingLevel={thinkingLevel} setThinkingLevel={setThinkingLevel} historyLimit={historyLimit} setHistoryLimit={setHistoryLimit} aspectRatio={aspectRatio} setAspectRatio={setAspectRatio} systemPrompts={systemPrompts} setSystemPrompts={setSystemPrompts} activePromptId={activePromptId} setActivePromptId={setActivePromptId} saveSettings={saveSettings} onSend={handleSendFromComposer} onStop={stopStreaming} />
      </div>
    </div>
  );
}
