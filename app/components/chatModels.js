import { Image as ImageIcon, Sparkles, Zap } from "lucide-react";

export const CHAT_MODELS = [
  {
    id: "gemini-3-flash-preview",
    name: "快速",
    shortName: "快速",
    Icon: Zap,
    color: "text-yellow-400",
  },
  {
    id: "gemini-3-pro-preview",
    name: "思考",
    shortName: "思考",
    Icon: Sparkles,
    color: "text-purple-400",
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "图片",
    shortName: "图片",
    Icon: ImageIcon,
    color: "text-pink-400",
  },
];


