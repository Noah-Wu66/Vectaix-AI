import mongoose from "mongoose";

const VideoGenerationTaskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    arkTaskId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "succeeded", "failed", "cancelled", "expired"],
      default: "queued",
      index: true,
    },
    model: {
      type: String,
      required: true,
    },
    prompt: {
      type: String,
      default: "",
    },
    inputMode: {
      type: String,
      enum: ["text", "image"],
      required: true,
    },
    params: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    error: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    usage: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    arkResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    remoteVideoUrl: {
      type: String,
      default: null,
    },
    videoUrl: {
      type: String,
      default: null,
    },
    videoBlobUrl: {
      type: String,
      default: null,
    },
    remoteLastFrameUrl: {
      type: String,
      default: null,
    },
    lastFrameUrl: {
      type: String,
      default: null,
    },
    lastFrameBlobUrl: {
      type: String,
      default: null,
    },
    arkCreatedAt: {
      type: Date,
      default: null,
    },
    arkUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

VideoGenerationTaskSchema.index({ userId: 1, updatedAt: -1 });
VideoGenerationTaskSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export default mongoose.models.VideoGenerationTask ||
  mongoose.model("VideoGenerationTask", VideoGenerationTaskSchema);
