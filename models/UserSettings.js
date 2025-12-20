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
    thinkingLevel: {
        type: String,
        default: 'high'
    },
    historyLimit: {
        type: Number,
        default: 0
    },
    aspectRatio: {
        type: String,
        default: '16:9'
    },
    systemPrompts: [SystemPromptSchema],
    activeSystemPromptId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.UserSettings || mongoose.model('UserSettings', UserSettingsSchema);
