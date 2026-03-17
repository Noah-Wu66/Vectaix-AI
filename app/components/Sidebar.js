"use client";

import { useState, useRef, useEffect } from "react";
import { Check, Copy, LogOut, Pencil, Pin, Plus, Trash2, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import { ModelGlyph } from "./ModelVisuals";
import { AGENT_MODEL_ID, isCouncilModel } from "@/lib/shared/models";

export default function Sidebar({
  isOpen,
  conversations,
  currentConversationId,
  user,
  avatar,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenProfile,
  onLogout,
  onClose,
  onTogglePinConversation,
  onDuplicateConversation,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, title: "" });
  const [pinConfirm, setPinConfirm] = useState({ open: false, id: null, title: "", nextPinned: false });
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [activeActionsId, setActiveActionsId] = useState(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleDeleteClick = (conv, e) => {
    e.stopPropagation();
    setDeleteConfirm({ open: true, id: conv._id, title: conv.title });
  };

  const handleConfirmDelete = async () => {
    try {
      if (deleteConfirm.id) {
        await onDeleteConversation(deleteConfirm.id);
      }
    } finally {
      setDeleteConfirm({ open: false, id: null, title: "" });
    }
  };

  const handleEditClick = (conv, e) => {
    e.stopPropagation();
    setEditingId(conv._id);
    setEditingTitle(conv.title);
  };

  const handlePinClick = (conv, e) => {
    e.stopPropagation();
    const nextPinned = !conv.pinned;
    setPinConfirm({ open: true, id: conv._id, title: conv.title, nextPinned });
  };

  const handleConfirmPin = async () => {
    try {
      if (pinConfirm.id) {
        await onTogglePinConversation(pinConfirm.id, pinConfirm.nextPinned);
      }
    } finally {
      setPinConfirm({ open: false, id: null, title: "", nextPinned: false });
    }
  };

  const handleSaveEdit = () => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== conversations.find(c => c._id === editingId)?.title) {
      onRenameConversation(editingId, trimmed);
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const canDuplicateConversation = (conv) => {
    return conv?.model !== AGENT_MODEL_ID && !isCouncilModel(conv?.model);
  };

  const revealActions = (id) => {
    setActiveActionsId(id);
  };

  const hideActions = (id) => {
    setActiveActionsId((current) => (current === id ? null : current));
  };

  const handleConversationTouchStart = (conv, e) => {
    if (activeActionsId === conv._id || editingId === conv._id) return;
    revealActions(conv._id);
  };

  const handleDuplicateClick = async (conv, e) => {
    e.stopPropagation();
    await onDuplicateConversation?.(conv._id);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <>
      <div
        className={`fixed md:relative z-30 w-64 h-full bg-zinc-50 border-r border-zinc-200 flex-col ${isOpen ? "flex" : "hidden md:flex"
          }`}
      >
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
          <button
            onClick={onStartNewChat}
            className="flex-1 flex items-center gap-2 bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-700 p-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> 新对话
          </button>
          <button onClick={onClose} className="md:hidden p-2 text-zinc-400 ml-2">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
          {conversations.map((conv) => (
            <div
              key={conv._id}
              onMouseEnter={() => revealActions(conv._id)}
              onMouseLeave={() => hideActions(conv._id)}
              className={`flex items-center gap-0.5 rounded-lg transition-colors ${currentConversationId === conv._id
                ? "bg-white border border-zinc-200"
                : "hover:bg-white"
                }`}
            >
              {editingId === conv._id ? (
                <div className="flex-1 flex items-center gap-1 p-1.5">
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveEdit}
                    className="flex-1 px-2 py-1.5 text-sm border border-zinc-300 rounded-md focus:outline-none focus:border-zinc-400 bg-white"
                  />
                  <button
                    onClick={handleSaveEdit}
                    className="p-1.5 text-green-500 hover:bg-zinc-100 rounded transition-colors"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="p-1.5 text-zinc-400 hover:bg-zinc-100 rounded transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <button
                      onClick={() => onLoadConversation(conv._id)}
                      onTouchStart={(e) => handleConversationTouchStart(conv, e)}
                      className={`flex-1 flex items-center gap-1.5 text-left py-3 pl-3 pr-0.5 text-sm min-w-0 ${currentConversationId === conv._id
                        ? "text-zinc-900 font-medium"
                        : "text-zinc-600"
                        }`}
                    >
                      <span className="shrink-0"><ModelGlyph model={conv.model} size={16} /></span>
                      <span className="truncate">{conv.title}</span>
                      {conv?.hasActiveRun ? (
                        <span
                          className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100"
                          aria-label="执行中"
                          title="执行中"
                        >
                          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-emerald-600 border-t-transparent" />
                        </span>
                      ) : null}
                  </button>
                  <div className={`mr-1 flex items-center gap-0.5 transition-opacity ${activeActionsId === conv._id ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                    <button
                      onClick={(e) => handlePinClick(conv, e)}
                      onFocus={() => revealActions(conv._id)}
                      className={`p-1.5 transition-colors ${conv.pinned
                        ? "text-blue-600 hover:text-blue-700"
                        : "text-zinc-400 hover:text-zinc-600"
                        }`}
                      title={conv.pinned ? "取消置顶" : "置顶"}
                    >
                      <Pin size={14} fill={conv.pinned ? "currentColor" : "none"} />
                    </button>
                    {canDuplicateConversation(conv) ? (
                      <button
                        onClick={(e) => handleDuplicateClick(conv, e)}
                        onFocus={() => revealActions(conv._id)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                        title="复制话题"
                      >
                        <Copy size={14} />
                      </button>
                    ) : null}
                    <button
                      onClick={(e) => handleEditClick(conv, e)}
                      onFocus={() => revealActions(conv._id)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="重命名"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(conv, e)}
                      onFocus={() => revealActions(conv._id)}
                      className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-200">
          <div className="flex items-center justify-between">
            <button
              onClick={onOpenProfile}
              className="flex items-center gap-2 flex-1 hover:bg-white p-2 rounded-lg transition-colors -ml-2 text-left mr-2"
            >
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  className="w-8 h-8 rounded-lg object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-zinc-500 flex items-center justify-center text-xs font-semibold text-white">
                  {user?.email?.[0]?.toUpperCase?.()}
                </div>
              )}
              <div className="text-xs truncate max-w-[100px] text-zinc-600 font-medium">
                {user?.email}
              </div>
            </button>
            <button
              onClick={onLogout}
              className="text-zinc-400 hover:text-red-500 transition-colors p-2"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, title: "" })}
        onConfirm={handleConfirmDelete}
        title="删除对话"
        message={`确定要删除「${deleteConfirm.title}」吗？此操作无法撤销。`}
        confirmText="删除"
        danger
      />
      <ConfirmModal
        open={pinConfirm.open}
        onClose={() => setPinConfirm({ open: false, id: null, title: "", nextPinned: false })}
        onConfirm={handleConfirmPin}
        title={pinConfirm.nextPinned ? "置顶对话" : "取消置顶"}
        message={pinConfirm.nextPinned
          ? `确定要置顶「${pinConfirm.title}」吗？`
          : `确定要取消置顶「${pinConfirm.title}」吗？`}
        confirmText={pinConfirm.nextPinned ? "置顶" : "取消置顶"}
      />
    </>
  );
}
