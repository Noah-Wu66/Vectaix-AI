import { Sparkles, Zap, Image, Brain, Lightbulb } from "lucide-react";

export const CHAT_MODELS = [
  {
    id: "gemini-3-flash-preview",
    name: "快速",
    shortName: "快速",
    Icon: Zap,
    color: "text-yellow-400",
    provider: "gemini",
  },
  {
    id: "gemini-3-pro-preview",
    name: "思考",
    shortName: "思考",
    Icon: Sparkles,
    color: "text-purple-400",
    provider: "gemini",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "推理",
    shortName: "推理",
    Icon: Lightbulb,
    color: "text-orange-400",
    provider: "claude",
  },
  {
    id: "claude-opus-4-5-20251101",
    name: "深度",
    shortName: "深度",
    Icon: Brain,
    color: "text-pink-400",
    provider: "claude",
  },
  {
    id: "image-studio",
    name: "图片",
    shortName: "图片",
    Icon: Image,
    color: "text-blue-400",
    externalLink: "https://studio.vectaix.com/",
  },
];


