import { Image } from "lucide-react";

export const CHAT_MODELS = [
  {
    id: "gemini-3-flash-preview",
    name: "Flash",
    shortName: "Flash",
    provider: "gemini",
  },
  {
    id: "gemini-3-pro-preview",
    name: "Pro",
    shortName: "Pro",
    provider: "gemini",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Sonnet",
    shortName: "Sonnet",
    provider: "claude",
  },
  {
    id: "claude-opus-4-5-20251101",
    name: "Opus",
    shortName: "Opus",
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


