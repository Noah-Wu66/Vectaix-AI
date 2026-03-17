import mongoose from "mongoose";

const ChatRunSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
    index: true,
  },
  messageId: {
    type: String,
    required: true,
    index: true,
  },
  provider: {
    type: String,
    required: true,
    index: true,
  },
  model: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    required: true,
    default: "queued",
    index: true,
  },
  phase: {
    type: String,
    default: "queued",
  },
  promptSnapshot: {
    type: String,
    default: "",
  },
  historySnapshot: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  configSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  settingsSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  historyLimit: {
    type: Number,
    default: 0,
  },
  mode: {
    type: String,
    default: "send",
  },
  outputText: {
    type: String,
    default: "",
  },
  thoughtText: {
    type: String,
    default: "",
  },
  citations: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  timeline: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  councilExperts: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  councilExpertStates: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  councilSummaryState: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  errorMessage: {
    type: String,
    default: "",
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  finishedAt: {
    type: Date,
    default: null,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

ChatRunSchema.index({ userId: 1, status: 1, updatedAt: -1 });
ChatRunSchema.index({ conversationId: 1, status: 1, updatedAt: -1 });

export default mongoose.models.ChatRun || mongoose.model("ChatRun", ChatRunSchema);
