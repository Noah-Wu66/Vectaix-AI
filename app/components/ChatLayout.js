"use client";

import ChatHeader from "./ChatHeader";
import Composer from "./Composer";
import ConfirmModal from "./ConfirmModal";
import MessageList from "./MessageList";
import ProfileModal from "./ProfileModal";
import Sidebar from "./Sidebar";

export default function ChatLayout({
  isDark,
  user,
  showProfileModal,
  onCloseProfile,
  themeMode,
  fontSize,
  onThemeModeChange,
  onFontSizeChange,
  switchModelOpen,
  onCloseSwitchModel,
  onConfirmSwitchModel,
  activePromptIds,
  sidebarOpen,
  conversations,
  currentConversationId,
  onStartNewChat,
  onLoadConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenProfile,
  onLogout,
  onCloseSidebar,
  onToggleSidebar,
  messages,
  loading,
  chatEndRef,
  messageListRef,
  onMessageListScroll,
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
}) {
  return (
    <div className={`app-root flex font-sans overflow-hidden ${isDark ? "dark-mode" : "light-mode"}`}>
      <ProfileModal open={showProfileModal} onClose={onCloseProfile} user={user} themeMode={themeMode} fontSize={fontSize} onThemeModeChange={onThemeModeChange} onFontSizeChange={onFontSizeChange} />
      <ConfirmModal open={switchModelOpen} onClose={onCloseSwitchModel} onConfirm={onConfirmSwitchModel} title="切换模型将新建对话" message="图片模型与快速/思考模型不能出现在同一个会话中。切换将新建对话，当前对话会保留在历史记录中。" confirmText="新建对话并切换" cancelText="取消" />
      <Sidebar isOpen={sidebarOpen} conversations={conversations} currentConversationId={currentConversationId} user={user} onStartNewChat={onStartNewChat} onLoadConversation={onLoadConversation} onDeleteConversation={onDeleteConversation} onRenameConversation={onRenameConversation} onOpenProfile={onOpenProfile} onLogout={onLogout} onClose={onCloseSidebar} />
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
        />
        <Composer {...composerProps} />
      </div>
    </div>
  );
}


