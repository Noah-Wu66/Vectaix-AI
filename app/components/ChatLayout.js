"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import ChatHeader from "./ChatHeader";
import Composer from "./Composer";
import MessageList from "./MessageList";
import ProfileModal from "./ProfileModal";
import Sidebar from "./Sidebar";

export default function ChatLayout({
  user,
  showProfileModal,
  onCloseProfile,
  themeMode,
  fontSize,
  onThemeModeChange,
  onFontSizeChange,
  completionSoundVolume,
  onCompletionSoundVolumeChange,
  sidebarOpen,
  conversations,
  currentConversationId,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRenameConversation,
  onTogglePinConversation,
  onOpenProfile,
  onLogout,
  onCloseSidebar,
  onToggleSidebar,
  messages,
  loading,
  chatEndRef,
  messageListRef,
  onMessageListScroll,
  showScrollButton,
  onScrollToBottom,
  editingMsgIndex,
  editingContent,
  editingImageAction,
  editingImage,
  fontSizeClass,
  onEditingContentChange,
  onEditingImageSelect,
  onEditingImageRemove,
  onEditingImageKeep,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onDeleteModelMessage,
  onDeleteUserMessage,
  onRegenerateModelMessage,
  onStartEdit,
  composerProps,
  userAvatar,
  onAvatarChange,
  isAdmin,
}) {
  return (
    <div className="app-root flex font-sans overflow-hidden">
      <ProfileModal open={showProfileModal} onClose={onCloseProfile} user={user} isAdmin={isAdmin} themeMode={themeMode} fontSize={fontSize} onThemeModeChange={onThemeModeChange} onFontSizeChange={onFontSizeChange} completionSoundVolume={completionSoundVolume} onCompletionSoundVolumeChange={onCompletionSoundVolumeChange} avatar={userAvatar} onAvatarChange={onAvatarChange} />
      <Sidebar isOpen={sidebarOpen} conversations={conversations} currentConversationId={currentConversationId} user={user} avatar={userAvatar} onStartNewChat={onStartNewChat} onLoadConversation={onLoadConversation} onDeleteConversation={onDeleteConversation} onRenameConversation={onRenameConversation} onTogglePinConversation={onTogglePinConversation} onOpenProfile={onOpenProfile} onLogout={onLogout} onClose={onCloseSidebar} />
      <div className="flex-1 flex flex-col w-full h-full relative">
        <ChatHeader onToggleSidebar={onToggleSidebar} />
        <MessageList
          messages={messages}
          loading={loading}
          chatEndRef={chatEndRef}
          listRef={messageListRef}
          onScroll={onMessageListScroll}
          editingMsgIndex={editingMsgIndex}
          editingContent={editingContent}
          editingImageAction={editingImageAction}
          editingImage={editingImage}
          fontSizeClass={fontSizeClass}
          model={composerProps?.model}
          onEditingContentChange={onEditingContentChange}
          onEditingImageSelect={onEditingImageSelect}
          onEditingImageRemove={onEditingImageRemove}
          onEditingImageKeep={onEditingImageKeep}
          onCancelEdit={onCancelEdit}
          onSubmitEdit={onSubmitEdit}
          onCopy={onCopy}
          onDeleteModelMessage={onDeleteModelMessage}
          onDeleteUserMessage={onDeleteUserMessage}
          onRegenerateModelMessage={onRegenerateModelMessage}
          onStartEdit={onStartEdit}
          userAvatar={userAvatar}
        />
        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              onClick={onScrollToBottom}
              className="absolute bottom-40 md:bottom-36 left-0 right-0 mx-auto z-10 w-9 h-9 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"
              type="button"
              aria-label="滚动到底部"
            >
              <ChevronDown size={20} />
            </motion.button>
          )}
        </AnimatePresence>
        <Composer {...composerProps} />
      </div>
    </div>
  );
}
