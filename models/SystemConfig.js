import mongoose from "mongoose";

const SystemConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  routes: {
    openai: {
      type: String,
      enum: ["default", "zenmux"],
      default: "default",
    },
    opus: {
      type: String,
      enum: ["default", "zenmux"],
      default: "default",
    },
    gemini: {
      type: String,
      enum: ["default", "zenmux"],
      default: "default",
    },
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.SystemConfig || mongoose.model("SystemConfig", SystemConfigSchema);
