"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { upload } from '@vercel/blob/client';
import {
    Send,
    Sparkles,
    Zap,
    Image as ImageIcon,
    Settings2,
    Bot,
    User,
    Loader2,
    Paperclip,
    X,
    ChevronDown,
    ChevronUp,
    BrainCircuit,
    Plus,
    LogOut,
    Menu,
    UserCog,
    Lock
} from "lucide-react";
import ReactMarkdown from "react-markdown";

// Helper to parse thinking content
const parseContent = (text) => {
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    let thought = "";
    let content = text;
    const startTag = "<thinking>";
    const endTag = "</thinking>";
    const startIndex = text.indexOf(startTag);

    if (startIndex !== -1) {
        const endIndex = text.indexOf(endTag, startIndex);
        if (endIndex !== -1) {
            thought = text.substring(startIndex + startTag.length, endIndex);
            content = text.substring(0, startIndex) + text.substring(endIndex + endTag.length);
        } else {
            thought = text.substring(startIndex + startTag.length);
            content = text.substring(0, startIndex);
        }
    }
    return { thought, content };
};

export default function Home() {
    // --- Auth State ---
    const [user, setUser] = useState(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // --- Profile/Password Change State ---
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [pwMsg, setPwMsg] = useState('');

    // --- Chat State ---
    const [conversations, setConversations] = useState([]);
    const [currentConversationId, setCurrentConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // --- Settings State ---
    const [model, setModel] = useState("gemini-3-pro-preview");
    const [thinkingLevel, setThinkingLevel] = useState("high");
    const [mediaResolution, setMediaResolution] = useState("media_resolution_high");
    const [historyLimit, setHistoryLimit] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [aspectRatio, setAspectRatio] = useState("16:9");

    // --- Upload State ---
    const [selectedImage, setSelectedImage] = useState(null);
    const fileInputRef = useRef(null);
    const chatEndRef = useRef(null);

    useEffect(() => {
        fetch('/api/auth/me').then(res => res.json()).then(data => {
            if (data.user) { setUser(data.user); fetchConversations(); }
            else { setShowAuthModal(true); }
        });
    }, []);

    const fetchConversations = async () => {
        try {
            const res = await fetch('/api/conversations');
            const data = await res.json();
            if (data.conversations) setConversations(data.conversations);
        } catch (e) { console.error(e); }
    };

    const scrollToBottom = () => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); };
    useEffect(() => { scrollToBottom(); }, [messages]);

    const handleAuth = async (e) => {
        e.preventDefault();
        const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const body = authMode === 'login' ? { email, password } : { email, password, confirmPassword };
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success || data.user) { setUser(data.user); setShowAuthModal(false); fetchConversations(); }
        else { alert(data.error); }
    };

    const handleLogout = async () => {
        await fetch('/api/auth/me', { method: 'DELETE' });
        setUser(null); setMessages([]); setConversations([]); setShowAuthModal(true); setShowProfileModal(false);
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setPwMsg('');
        if (newPassword !== confirmNewPassword) return setPwMsg("两次输入的新密码不一致");

        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword, confirmNewPassword })
        });
        const data = await res.json();
        if (data.success) {
            setPwMsg("密码修改成功");
            setOldPassword(''); setNewPassword(''); setConfirmNewPassword('');
            setTimeout(() => setPwMsg(''), 3000);
        } else {
            setPwMsg(data.error || "密码修改失败");
        }
    };

    const loadConversation = async (id) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/conversations/${id}`);
            const data = await res.json();
            if (data.conversation) {
                setMessages(data.conversation.messages.map(m => {
                    const { thought, content } = parseContent(m.content);
                    return { ...m, thought: m.thought || thought, content };
                }));
                setCurrentConversationId(id);
                if (window.innerWidth < 768) setSidebarOpen(false);
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    };

    const startNewChat = () => { setCurrentConversationId(null); setMessages([]); if (window.innerWidth < 768) setSidebarOpen(false); };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 20 * 1024 * 1024) { }
            const reader = new FileReader();
            reader.onload = (e) => {
                setSelectedImage({ file: file, preview: e.target.result, name: file.name });
            };
            reader.readAsDataURL(file);
        }
    };

    const removeImage = () => { setSelectedImage(null); if (fileInputRef.current) fileInputRef.current.value = ""; };

    const handleSend = async () => {
        if ((!input.trim() && !selectedImage) || loading) return;

        // Optimistic Update
        const userMsg = { role: "user", content: input, type: "text", image: selectedImage ? selectedImage.preview : null };
        setMessages(prev => [...prev, userMsg]);
        const currentInput = input;
        const currentImage = selectedImage;

        setInput(""); setSelectedImage(null); setLoading(true);

        try {
            let imageUrl = null;
            if (currentImage && currentImage.file) {
                try {
                    const blob = await upload(currentImage.file.name, currentImage.file, { access: 'public', handleUploadUrl: '/api/upload', });
                    imageUrl = blob.url;
                } catch (uploadError) { console.error("Upload failed:", uploadError); throw new Error("Image upload failed"); }
            }

            const config = {};
            if (model !== "gemini-3-pro-image-preview") {
                config.thinkingLevel = thinkingLevel;
                if (imageUrl) { config.image = { url: imageUrl }; config.mediaResolution = mediaResolution; }
            } else { config.imageConfig = { aspectRatio: aspectRatio, imageSize: "4K" }; }

            const historyPayload = messages.map(m => ({ role: m.role, content: m.content, image: null }));

            const payload = {
                prompt: currentInput, model: model, config: config, history: historyPayload, historyLimit: historyLimit, conversationId: currentConversationId
            };

            if (model === "gemini-3-pro-image-preview") {
                const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), });
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                if (data.conversationId && !currentConversationId) { setCurrentConversationId(data.conversationId); fetchConversations(); }

                if (data.type === 'image') {
                    setMessages(prev => [...prev, { role: "model", content: data.data, mimeType: data.mimeType, type: "image" }]);
                } else {
                    setMessages(prev => [...prev, { role: "model", content: data.content, type: "text" }]);
                }
            } else {
                const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), });
                if (!res.ok) throw new Error(res.statusText);

                const newConvId = res.headers.get('X-Conversation-Id');
                if (newConvId && !currentConversationId) { setCurrentConversationId(newConvId); fetchConversations(); }

                const streamMsgId = Date.now();
                setMessages(prev => [...prev, { role: "model", content: "", type: "text", id: streamMsgId, isStreaming: true, thought: "" }]);

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let done = false; let fullText = "";

                while (!done) {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        fullText += chunk;
                        const { thought, content } = parseContent(fullText);
                        setMessages(prev => prev.map(msg => msg.id === streamMsgId ? { ...msg, content, thought } : msg));
                    }
                }
                setMessages(prev => prev.map(msg => msg.id === streamMsgId ? { ...msg, isStreaming: false } : msg));
            }
        } catch (err) { console.error(err); setMessages(prev => [...prev, { role: "model", content: "Error: " + err.message, type: "error" }]); } finally { setLoading(false); }
    };

    const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };
    const models = [
        { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", icon: Sparkles, color: "text-purple-400", shortName: "Pro" },
        { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", icon: Zap, color: "text-yellow-400", shortName: "Flash" },
        { id: "gemini-3-pro-image-preview", name: "Gemini 3 Image", icon: ImageIcon, color: "text-pink-400", shortName: "Image" },
    ];

    if (showAuthModal) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-4">
                <div className="w-full max-w-sm">
                    <div className="flex justify-center mb-8">
                        <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center"><Sparkles size={24} className="text-white" /></div>
                    </div>
                    <h2 className="text-xl font-semibold text-center mb-1 text-zinc-900">{authMode === 'login' ? '欢迎回来' : '创建账号'}</h2>
                    <p className="text-center text-zinc-500 mb-8 text-sm">登录以继续使用 Vectaix AI</p>
                    <form onSubmit={handleAuth} className="space-y-3">
                        <input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 transition-colors" required />
                        <input type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 transition-colors" required />
                        {authMode === 'register' && (
                            <input type="password" placeholder="确认密码" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 transition-colors" required />
                        )}
                        <button className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-3 rounded-lg transition-colors">{authMode === 'login' ? '登录' : '注册'}</button>
                    </form>
                    <p className="text-center mt-6 text-zinc-500 text-sm">
                        {authMode === 'login' ? "还没有账号？" : "已有账号？"}
                        <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-zinc-900 hover:underline font-medium ml-1">{authMode === 'login' ? '立即注册' : '立即登录'}</button>
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-[100dvh] text-zinc-800 font-sans bg-white overflow-hidden">

            {/* Profile Modal */}
            <AnimatePresence>
                {showProfileModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setShowProfileModal(false)}>
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white p-6 md:p-8 rounded-2xl w-full max-w-md shadow-xl border border-zinc-200 relative" onClick={e => e.stopPropagation()}>
                            <button onClick={() => setShowProfileModal(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600"><X size={20} /></button>

                            <div className="text-center mb-6">
                                <div className="w-14 h-14 rounded-xl bg-zinc-900 mx-auto flex items-center justify-center text-xl font-semibold text-white mb-3">{user?.email?.[0].toUpperCase()}</div>
                                <h2 className="text-lg font-semibold text-zinc-900">{user?.email}</h2>
                                <p className="text-sm text-zinc-500">个人中心</p>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
                                    <h3 className="text-sm font-medium text-zinc-700 mb-3 flex items-center gap-2"><Lock size={14} /> 修改密码</h3>
                                    <form onSubmit={handleChangePassword} className="space-y-3">
                                        <input type="password" placeholder="当前密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none" required />
                                        <input type="password" placeholder="新密码" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none" required />
                                        <input type="password" placeholder="确认新密码" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} className="w-full bg-white border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-800 focus:border-zinc-400 outline-none" required />

                                        <button className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-medium py-2.5 rounded-lg text-sm transition-colors">更新密码</button>
                                    </form>
                                    {pwMsg && <p className={`text-xs mt-3 text-center ${pwMsg.includes('成功') ? 'text-green-600' : 'text-red-500'}`}>{pwMsg}</p>}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {(sidebarOpen || window.innerWidth >= 768) && (
                    <motion.div initial={{ x: -280, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -280, opacity: 0 }} className={`fixed md:relative z-30 w-64 h-full bg-zinc-50 border-r border-zinc-200 flex flex-col transition-all ${!sidebarOpen && 'hidden md:flex'}`}>
                        <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
                            <button onClick={startNewChat} className="flex-1 flex items-center gap-2 bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-700 p-2.5 rounded-lg text-sm font-medium transition-colors"><Plus size={16} /> 新对话</button>
                            <button onClick={() => setSidebarOpen(false)} className="md:hidden p-2 text-zinc-400 ml-2"><X size={18} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
                            {conversations.map(conv => (
                                <button key={conv._id} onClick={() => loadConversation(conv._id)} className={`w-full text-left p-3 rounded-lg text-sm truncate transition-colors ${currentConversationId === conv._id ? 'bg-white border border-zinc-200 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-white'}`}>{conv.title}</button>
                            ))}
                        </div>
                        <div className="p-4 border-t border-zinc-200">
                            <div className="flex items-center justify-between">
                                <button onClick={() => setShowProfileModal(true)} className="flex items-center gap-2 flex-1 hover:bg-white p-2 rounded-lg transition-colors -ml-2 text-left mr-2">
                                    <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-xs font-semibold text-white">{user?.email?.[0].toUpperCase()}</div>
                                    <div className="text-xs truncate max-w-[100px] text-zinc-600 font-medium">{user?.email}</div>
                                </button>
                                <button onClick={handleLogout} className="text-zinc-400 hover:text-red-500 transition-colors p-2"><LogOut size={16} /></button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex-1 flex flex-col w-full h-full relative">
                <header className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between bg-white z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 -ml-2 text-zinc-500 hover:text-zinc-700 md:hidden"><Menu size={20} /></button>
                        <div className="flex items-center gap-2"><Sparkles size={18} className="text-zinc-900" /><h1 className="font-semibold text-lg tracking-tight text-zinc-900 hidden md:block">Vectaix AI</h1></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-zinc-100 text-zinc-700' : 'hover:bg-zinc-100 text-zinc-500'}`}><Settings2 size={20} /></button>
                        <AnimatePresence>
                            {showSettings && (
                                <>
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setShowSettings(false)} />
                                    <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="absolute right-4 top-14 w-64 p-4 bg-white rounded-xl z-50 flex flex-col gap-4 shadow-lg border border-zinc-200">
                                        <div className="flex justify-between items-center md:hidden"><span className="font-medium text-zinc-900">设置</span><button onClick={() => setShowSettings(false)} className="text-zinc-400"><X size={18} /></button></div>
                                        <div>
                                            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">历史限制</label>
                                            <input type="range" min="0" max="20" step="2" value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))} className="w-full accent-zinc-900 h-1 bg-zinc-200 rounded-full" />
                                            <span className="text-xs text-right block mt-1 text-zinc-600">{historyLimit || '无限制'} 条</span>
                                        </div>
                                        {model !== "gemini-3-pro-image-preview" ? (
                                            <div><label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">思考深度</label><select value={thinkingLevel} onChange={(e) => setThinkingLevel(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"><option value="high">深度</option><option value="low">快速</option></select></div>
                                        ) : (
                                            <div><label className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2 block">宽高比</label><select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 text-sm text-zinc-700"><option value="16:9">16:9</option><option value="1:1">1:1</option></select></div>
                                        )}
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth custom-scrollbar mobile-scroll">
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-400">
                            <Sparkles size={40} className="mb-4 text-zinc-300" /><p className="font-medium">开始新对话</p>
                        </div>
                    ) : (
                        messages.map((msg, i) => (
                            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
                                    {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                                </div>
                                <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start w-full'}`}>
                                    {msg.role === 'model' && msg.thought && <ThinkingBlock thought={msg.thought} isStreaming={msg.isStreaming} />}
                                    <div className={`px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-800'}`}>
                                        {msg.image && <img src={msg.image} className="mb-2 max-h-48 rounded-lg" />}
                                        {msg.type === 'image' ? (
                                            <img src={`data:${msg.mimeType};base64,${msg.content}`} className="max-w-full h-auto rounded-lg" />
                                        ) : (
                                            <div className="prose prose-sm max-w-none"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                    {loading && <div className="flex gap-2 items-center text-zinc-500 text-sm ml-11"><Loader2 size={14} className="animate-spin" /> 思考中...</div>}
                    <div ref={chatEndRef} />
                </div>

                <div className="p-3 md:p-4 bg-white border-t border-zinc-200 z-20 shrink-0 pb-safe">
                    <div className="flex overflow-x-auto pb-2 gap-2 no-scrollbar md:justify-center">
                        {models.map((m) => (
                            <button key={m.id} onClick={() => setModel(m.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 whitespace-nowrap transition-colors ${model === m.id ? 'bg-zinc-900 border-zinc-900 text-white' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'}`}><m.icon size={12} /> {m.shortName}</button>
                        ))}
                    </div>
                    <div className="relative max-w-3xl mx-auto flex items-end gap-2">
                        <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                        <button onClick={() => fileInputRef.current?.click()} className={`p-3 rounded-xl border transition-colors ${selectedImage ? 'border-zinc-400 text-zinc-600 bg-zinc-100' : 'border-zinc-200 text-zinc-400 hover:bg-zinc-50'}`}><Paperclip size={18} /></button>
                        <div className="flex-1 relative">
                            {selectedImage && (
                                <div className="absolute -top-12 left-0 bg-white p-2 rounded-lg border border-zinc-200 shadow-sm flex items-center gap-2">
                                    <span className="text-xs text-zinc-600 truncate max-w-[100px]">{selectedImage.name}</span>
                                    <button onClick={removeImage} className="text-zinc-400 hover:text-red-500"><X size={12} /></button>
                                </div>
                            )}
                            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="输入消息..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-4 pr-12 py-3 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 resize-none transition-colors" rows={1} style={{ minHeight: '48px' }} />
                            <button onClick={handleSend} disabled={loading || (!input.trim() && !selectedImage)} className="absolute right-2 bottom-2 p-2 rounded-lg bg-zinc-900 text-white disabled:opacity-40 hover:bg-zinc-800 transition-colors"><Send size={16} /></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ThinkingBlock({ thought, isStreaming }) {
    const [collapsed, setCollapsed] = useState(false);
    useEffect(() => { if (!isStreaming) setCollapsed(true); }, [isStreaming]);
    const endRef = useRef(null);
    useEffect(() => { if (!collapsed) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thought, collapsed]);

    return (
        <div className="mb-2 w-full max-w-full">
            <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-[10px] font-medium text-zinc-500 hover:text-zinc-700 mb-1 uppercase tracking-wider bg-zinc-100 px-2 py-1 rounded-md transition-colors"><BrainCircuit size={12} /> 思考过程 {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}</button>
            <AnimatePresence>
                {!collapsed && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 150, opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-y-auto w-full text-xs text-zinc-600 font-mono">
                        {thought}{isStreaming && <span className="animate-pulse">|</span>}
                        <div ref={endRef} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
