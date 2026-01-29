import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
    id: { type: String },
    role: { type: String, required: true }, // 'user' or 'model'
    content: { type: String, default: '' },
    thought: { type: String }, // For model thinking blocks
    citations: { type: [mongoose.Schema.Types.Mixed] },
    type: { type: String, default: 'text', enum: ['text', 'parts', 'error'] },
    image: { type: String }, // URL
    mimeType: { type: String },
    // Gemini multi-turn image editing: persist sanitized content.parts with thoughtSignature
    // - text parts: { text, thought?, thoughtSignature? }
    // - image parts: { inlineData: { mimeType, url }, thoughtSignature? }
    parts: { type: [mongoose.Schema.Types.Mixed] },
    createdAt: { type: Date, default: Date.now }
});

const ConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    title: {
        type: String,
        default: 'New Chat',
    },
    model: {
        type: String,
        default: null,
    },
    // 对话专属参数设置
    settings: {
        thinkingLevel: { type: String, default: null },
        historyLimit: { type: Number, default: null },
        maxTokens: { type: Number, default: null },
        budgetTokens: { type: Number, default: null },
        activePromptId: { type: String, default: null },
    },
    messages: [MessageSchema],
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

export default mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
