import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
    role: { type: String, required: true }, // 'user' or 'model'
    content: { type: String, default: '' },
    thought: { type: String }, // For model thinking blocks
    type: { type: String, default: 'text' }, // 'text' or 'image'
    image: { type: String }, // Base64 or URL if stored separately, keeping usage simple
    mimeType: { type: String },
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
    messages: [MessageSchema],
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

export default mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
