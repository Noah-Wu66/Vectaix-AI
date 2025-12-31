import mongoose from 'mongoose';

const SystemPromptSchema = new mongoose.Schema({
    name: { type: String, required: true },
    content: { type: String, required: true }
});

const UserSettingsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    model: {
        type: String,
        default: 'gemini-3-pro-preview'
    },
    // 按模型分别保存思考深度（不兼容旧 thinkingLevel 字段）
    // e.g. { "gemini-3-flash-preview": "medium", "gemini-3-pro-preview": "high" }
    thinkingLevels: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({
            'gemini-3-flash-preview': 'high',
            'gemini-3-pro-preview': 'high'
        })
    },
    historyLimit: {
        type: Number,
        default: 0
    },
    systemPrompts: [SystemPromptSchema],
    activeSystemPromptId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    // 按模型分别保存激活的系统提示词
    // e.g. { "gemini-3-pro-preview": "<promptObjectId>", "gemini-3-flash-preview": "<promptObjectId>" }
    activeSystemPromptIds: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({})
    },
    themeMode: {
        type: String,
        default: 'system'  // light, dark, system
    },
    fontSize: {
        type: String,
        default: 'medium'  // small, medium, large
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.UserSettings || mongoose.model('UserSettings', UserSettingsSchema);
