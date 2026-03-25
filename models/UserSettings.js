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
    avatar: {
        type: String,
        default: null
    },
    modelRoutes: {
        openai: {
            type: String,
            enum: ['default', 'zenmux'],
            default: 'default',
        },
        opus: {
            type: String,
            enum: ['default', 'zenmux'],
            default: 'default',
        },
        gemini: {
            type: String,
            enum: ['default', 'native'],
            default: 'default',
        },
    },
    systemPrompts: [SystemPromptSchema],
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.UserSettings || mongoose.model('UserSettings', UserSettingsSchema);
