"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Lock,
  Settings,
  Palette,
  Type,
  Upload,
  X,
  Camera,
  Volume2,
} from "lucide-react";

import { upload } from "@vercel/blob/client";
import { useToast } from "./ToastProvider";
import ConfirmModal from "./ConfirmModal";

export default function ProfileModal({
  open,
  onClose,
  user,
  themeMode,
  fontSize,
  onThemeModeChange,
  onFontSizeChange,
  completionSoundVolume,
  onCompletionSoundVolumeChange,
  avatar,
  onAvatarChange,
}) {
  const toast = useToast();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showDataManager, setShowDataManager] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const [avatarLoading, setAvatarLoading] = useState(false);
  const normalizedVolume = Number.isFinite(Number(completionSoundVolume))
    ? Number(completionSoundVolume)
    : 60;

  const emailInitial = useMemo(() => {
    const c = user?.email?.[0];
    return c ? c.toUpperCase() : "?";
  }, [user?.email]);

  const avatarFileInputRef = useRef(null);
  const parseDownloadFilename = (contentDisposition) => {
    if (!contentDisposition || typeof contentDisposition !== "string") return null;
    const m = contentDisposition.match(/filename="([^"]+)"/i);
    return m?.[1] || null;
  };

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onExport = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/data/export", { method: "GET" });
      if (!res.ok) {
        let errText = "";
        try {
          const j = await res.json();
          errText = j?.error ? String(j.error) : "";
        } catch { }
        throw new Error(errText || "导出失败");
      }
      const blob = await res.blob();
      const filename =
        parseDownloadFilename(res.headers.get("content-disposition")) ||
        "vectaix-export.json";
      triggerDownload(blob, filename);
      toast.success("导出成功");
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "导出失败");
    } finally {
      setExportLoading(false);
    }
  };

  const onImportFile = async (file) => {
    if (!file) return;
    setPendingImportFile(file);
    setShowConfirmModal(true);
  };

  const confirmImport = async () => {
    if (!pendingImportFile) return;

    setImportLoading(true);
    try {
      const text = await pendingImportFile.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("文件不是合法 JSON");
      }

      const res = await fetch("/api/data/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "导入失败");
      toast.success(`导入成功（会话：${data?.imported?.conversationsCount ?? 0}）`);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "导入失败");
    } finally {
      setImportLoading(false);
      setPendingImportFile(null);
    }
  };

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.warning("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.warning("图片大小不能超过 5MB");
      return;
    }

    setAvatarLoading(true);
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      await onAvatarChange?.(blob.url);
      toast.success("头像更新成功");
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "头像上传失败");
    } finally {
      setAvatarLoading(false);
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = "";
    }
  };

  const submitChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      toast.warning("两次输入的新密码不一致");
      return;
    }

    setPwLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword, confirmNewPassword }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("密码修改成功");
        setOldPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      } else {
        toast.error(data.error || "密码修改失败");
      }
    } catch (err) {
      console.error(err);
      toast.error("密码修改失败");
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-2xl w-full max-w-md shadow-xl border border-zinc-200 relative"
              onClick={(e) => e.stopPropagation()}
            >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-6">
              <input
                type="file"
                ref={avatarFileInputRef}
                onChange={handleAvatarSelect}
                className="hidden"
                accept="image/*"
              />
              <button
                type="button"
                onClick={() => avatarFileInputRef.current?.click()}
                disabled={avatarLoading}
                className="relative w-16 h-16 rounded-xl mx-auto flex items-center justify-center mb-3 overflow-hidden group transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                title="点击更换头像"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-500 flex items-center justify-center text-xl font-semibold text-white">
                    {emailInitial}
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={20} className="text-white" />
                </div>
                {avatarLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </button>
              <h2 className="text-lg font-semibold text-zinc-900">
                {user?.email}
              </h2>
              <p className="text-sm text-zinc-500">个人中心</p>
            </div>

            <div className="space-y-3">
              {/* 修改密码 */}
              <button
                onClick={() => setShowChangePassword(!showChangePassword)}
                className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Lock size={14} /> 修改密码
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showChangePassword ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showChangePassword && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
                      <form onSubmit={submitChangePassword} className="space-y-3">
                        <input
                          type="password"
                          placeholder="当前密码"
                          value={oldPassword}
                          onChange={(e) => setOldPassword(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none"
                          required
                        />
                        <input
                          type="password"
                          placeholder="新密码"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none"
                          required
                        />
                        <input
                          type="password"
                          placeholder="确认新密码"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none"
                          required
                        />
                        <button
                          type="submit"
                          disabled={pwLoading}
                          className="w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                        >
                          更新密码
                        </button>
                      </form>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 外观设置 */}
              <button
                onClick={() => setShowAppearance(!showAppearance)}
                className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Settings size={14} /> 系统设置
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showAppearance ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showAppearance && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100 space-y-4">
                      {/* 主题模式 */}
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Palette size={12} /> 主题模式
                        </label>
                        <div className="flex gap-2">
                          {[
                            { id: "light", label: "浅色" },
                            { id: "dark", label: "深色" },
                            { id: "system", label: "跟随系统" },
                          ].map((t) => (
                            <button
                              key={t.id}
                              onClick={() => onThemeModeChange(t.id)}
                              type="button"
                              className={`flex-1 py-2 rounded-lg border transition-colors text-sm ${themeMode === t.id
                                ? "bg-zinc-600 text-white border-zinc-600"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 字体大小 */}
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Type size={12} /> 字体大小
                        </label>
                        <div className="flex gap-2">
                          {[
                            { id: "small", label: "小", size: "text-xs" },
                            { id: "medium", label: "中", size: "text-sm" },
                            { id: "large", label: "大", size: "text-base" },
                          ].map((f) => (
                            <button
                              key={f.id}
                              onClick={() => onFontSizeChange(f.id)}
                              type="button"
                              className={`flex-1 py-2 rounded-lg border transition-colors ${fontSize === f.id
                                ? "bg-zinc-600 text-white border-zinc-600"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100"
                                } ${f.size}`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 提示音音量 */}
                      <div>
                        <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block flex items-center gap-1">
                          <Volume2 size={12} /> 提示音音量
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={normalizedVolume}
                            onChange={(e) => onCompletionSoundVolumeChange?.(Number(e.target.value))}
                            className="w-full"
                          />
                          <span className="text-xs text-zinc-500 w-12 text-right">
                            {normalizedVolume <= 0 ? "关闭" : `${normalizedVolume}%`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 数据管理 */}
              <button
                onClick={() => setShowDataManager(!showDataManager)}
                className="w-full flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 rounded-xl p-4 border border-zinc-100 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Download size={14} /> 数据管理
                </span>
                <ChevronDown
                  size={16}
                  className={`text-zinc-400 transition-transform ${showDataManager ? "rotate-180" : ""
                    }`}
                />
              </button>

              <AnimatePresence>
                {showDataManager && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100 space-y-3">
                      <button
                        type="button"
                        onClick={onExport}
                        disabled={exportLoading || importLoading}
                        className="w-full bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <Download size={16} />
                        {exportLoading ? "导出中..." : "导出数据（JSON）"}
                      </button>

                      <div className="w-full">
                        <label className="w-full flex items-center justify-center gap-2 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-lg py-2.5 text-sm text-zinc-700 transition-colors cursor-pointer">
                          <Upload size={16} />
                          {importLoading ? "导入中..." : "导入数据（覆盖当前账号）"}
                          <input
                            type="file"
                            accept="application/json"
                            className="hidden"
                            disabled={exportLoading || importLoading}
                            onChange={(e) =>
                              onImportFile(e.target.files?.[0] || null)
                            }
                          />
                        </label>
                        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                          导入会清空当前账号的全部聊天记录与个人设置，然后按文件内容重建。
                          图片仅导入文件里保存的 URL/parts，不包含二进制图片。
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <ConfirmModal
      open={showConfirmModal}
      onClose={() => {
        setShowConfirmModal(false);
        setPendingImportFile(null);
      }}
      onConfirm={() => {
        setShowConfirmModal(false);
        confirmImport();
      }}
      title="确认导入"
      message="导入会覆盖当前账号的所有聊天记录与个人设置，且不可撤销。是否继续？"
      confirmText="确定"
      cancelText="取消"
      danger
    />
  </>
  );
}


