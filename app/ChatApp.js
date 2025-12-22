"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat } from "./lib/chatClient";
import { useAppViewportHeightVar } from "./lib/useAppViewportHeightVar";

import AuthModal from "./components/AuthModal";
import ChatHeader from "./components/ChatHeader";
import Composer from "./components/Composer";
import MessageList from "./components/MessageList";
import ProfileModal from "./components/ProfileModal";
import Sidebar from "./components/Sidebar";

const FONT_SIZE_CLASSES = { small: "text-size-small", medium: "text-size-medium", large: "text-size-large" };

export default function ChatApp() {
  useAppViewportHeightVar();
  // --- Auth State ---
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // --- UI State ---
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // --- Chat State ---
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  // --- Settings State ---
  const [model, setModel] = useState("gemini-3-pro-preview");
  const [thinkingLevel, setThinkingLevel] = useState("high");
  const [mediaResolution] = useState("media_resolution_high");
  const [historyLimit, setHistoryLimit] = useState(0);
  const [aspectRatio, setAspectRatio] = useState("16:9");

  // --- System Prompts State ---
  const [systemPrompts, setSystemPrompts] = useState([]);
  const [activePromptId, setActivePromptId] = useState(null);

  // --- Appearance State ---
  const [themeMode, setThemeMode] = useState("system"); // light, dark, system
  const [isDark, setIsDark] = useState(false);
  const [fontSize, setFontSize] = useState("medium"); // small, medium, large

  // --- Message Actions State ---
  const [editingMsgIndex, setEditingMsgIndex] = useState(null);
  const [editingContent, setEditingContent] = useState("");

  const chatEndRef = useRef(null);

  // -------- Settings --------
  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.settings) {
        setModel(data.settings.model || "gemini-3-pro-preview");
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

  // -------- Theme --------
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

  // -------- Boot --------
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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -------- Auth --------
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

  // -------- Conversations --------
  const loadConversation = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (data.conversation) {
        setMessages(data.conversation.messages || []);
        setCurrentConversationId(id);
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
    setCurrentConversationId(null);
    setMessages([]);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  // -------- Helpers --------
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

  // -------- Actions: Send / Regenerate / Edit --------
  const handleSendFromComposer = async ({ text, image }) => {
    if ((!text && !image) || loading) return;

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
        setLoading,
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
      setLoading,
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
      setLoading,
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
      className={`flex h-[100dvh] font-sans overflow-hidden ${
        isDark ? "dark-mode" : "light-mode"
      } ${FONT_SIZE_CLASSES[fontSize] || ""}`}
      style={{ height: "var(--app-height)" }}
    >
      <ProfileModal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
        themeMode={themeMode}
        fontSize={fontSize}
        onThemeModeChange={updateThemeMode}
        onFontSizeChange={updateFontSize}
      />

      <Sidebar
        isOpen={sidebarOpen}
        conversations={conversations}
        currentConversationId={currentConversationId}
        user={user}
        onStartNewChat={startNewChat}
        onLoadConversation={loadConversation}
        onDeleteConversation={deleteConversation}
        onOpenProfile={() => setShowProfileModal(true)}
        onLogout={handleLogout}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col w-full h-full relative">
        <ChatHeader onToggleSidebar={() => setSidebarOpen((v) => !v)} />

        <MessageList
          messages={messages}
          loading={loading}
          chatEndRef={chatEndRef}
          editingMsgIndex={editingMsgIndex}
          editingContent={editingContent}
          onEditingContentChange={setEditingContent}
          onCancelEdit={cancelEdit}
          onSubmitEdit={submitEditAndRegenerate}
          onCopy={copyMessage}
          onDeleteModelMessage={deleteModelMessage}
          onDeleteUserMessage={deleteUserMessage}
          onRegenerateModelMessage={regenerateModelMessage}
          onStartEdit={startEdit}
        />

        <Composer
          loading={loading}
          model={model}
          setModel={setModel}
          thinkingLevel={thinkingLevel}
          setThinkingLevel={setThinkingLevel}
          historyLimit={historyLimit}
          setHistoryLimit={setHistoryLimit}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          systemPrompts={systemPrompts}
          setSystemPrompts={setSystemPrompts}
          activePromptId={activePromptId}
          setActivePromptId={setActivePromptId}
          saveSettings={saveSettings}
          onSend={handleSendFromComposer}
        />
      </div>
    </div>
  );
}
