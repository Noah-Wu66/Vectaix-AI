import mongoose from "mongoose";

const MemoryEntrySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  scope: {
    type: String,
    required: true,
    default: "agent",
  },
  summary: {
    type: String,
    required: true,
  },
  sourceRef: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

MemoryEntrySchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.models.MemoryEntry || mongoose.model("MemoryEntry", MemoryEntrySchema);
