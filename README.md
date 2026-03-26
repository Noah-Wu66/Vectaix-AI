# Vectaix AI

[中文说明](./README.zh-CN.md)

Vectaix AI is an open-source AI workspace built for Vercel deployment.

## What It Includes

- Official provider support for OpenAI, Anthropic, Google Gemini, DeepSeek, and ByteDance Seed
- OpenRouter as the only third-party gateway
- User-level route switching for OpenAI / Claude / Gemini between `Official` and `OpenRouter`
- OpenRouter-only third-party models:
  - `xiaomi/mimo-v2-flash`
  - `minimax/minimax-m2.5`
- Email/password authentication
- Council workflow with GPT / Claude / Gemini experts and Seed summary

## Deployment

- Target platform: Vercel Pro
- Database: MongoDB
- File storage: Vercel Blob
- This repository is documented for cloud deployment. No local one-click runtime is described here.

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Auth token signing secret |
| `ADMIN_EMAILS` | No | Comma-separated admin email list |
| `OPENAI_API_KEY` | Yes | Official OpenAI access |
| `ANTHROPIC_API_KEY` | Yes | Official Anthropic access |
| `GEMINI_API_KEY` | Yes | Official Google Gemini access |
| `DEEPSEEK_API_KEY` | Yes | Official DeepSeek access |
| `ARK_API_KEY` | Yes | Official ByteDance Seed access |
| `OPENROUTER_API_KEY` | Yes | OpenRouter access for route switching and OpenRouter-only models |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | Optional for now | Current web search provider, pending later replacement |

## Model Routing

- `GPT-5.4`: Official OpenAI or OpenRouter
- `Claude Opus 4.6`: Official Anthropic or OpenRouter
- `Gemini 2.5 Pro`: Official Google or OpenRouter
- `DeepSeek V3.2`: Official only
- `Seed 2.0 Pro`: Official only
- `MiMo V2 Flash`: OpenRouter only
- `MiniMax M2.5`: OpenRouter only

## Notes

- README is the only place documenting environment variables for this repo.
- No `.env.example` file is provided.
- Web search is still on its previous provider and is intentionally not part of the new provider abstraction yet.
