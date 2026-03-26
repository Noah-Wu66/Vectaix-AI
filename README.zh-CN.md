# Vectaix AI

[English README](./README.md)

Vectaix AI 是一个面向 Vercel 部署的开源 AI 工作台。

## 当前能力

- 官方直连提供商：OpenAI、Anthropic、Google Gemini、DeepSeek、ByteDance Seed
- 唯一第三方网关：OpenRouter
- 登录用户都可以把 OpenAI / Claude / Gemini 切到 `官方` 或 `OpenRouter`
- 固定走 OpenRouter 的第三方模型：
  - `xiaomi/mimo-v2-flash`
  - `minimax/minimax-m2.5`
- 邮箱密码登录
- Council 三专家流程：GPT / Claude / Gemini 出观点，Seed 做最终汇总

## 部署说明

- 部署平台：Vercel Pro
- 数据库：MongoDB
- 文件存储：Vercel Blob
- 这个仓库按云端部署来写文档，不提供本地一键运行说明。

## 环境变量

| 变量名 | 是否必填 | 作用 |
| --- | --- | --- |
| `MONGO_URI` | 是 | MongoDB 连接字符串 |
| `JWT_SECRET` | 是 | 登录态签名密钥 |
| `ADMIN_EMAILS` | 否 | 管理员邮箱，多个用英文逗号分隔 |
| `OPENAI_API_KEY` | 是 | OpenAI 官方接口 |
| `ANTHROPIC_API_KEY` | 是 | Anthropic 官方接口 |
| `GEMINI_API_KEY` | 是 | Google Gemini 官方接口 |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek 官方接口 |
| `ARK_API_KEY` | 是 | ByteDance Seed 官方接口 |
| `OPENROUTER_API_KEY` | 是 | OpenRouter 线路和 OpenRouter 专属模型 |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | 暂时可选 | 当前 Web Search 还在用的旧搜索服务，后续会单独替换 |

## 模型线路

- `GPT-5.4`：官方 OpenAI 或 OpenRouter
- `Claude Opus 4.6`：官方 Anthropic 或 OpenRouter
- `Gemini 2.5 Pro`：官方 Google 或 OpenRouter
- `DeepSeek V3.2`：仅官方
- `Seed 2.0 Pro`：仅官方
- `MiMo V2 Flash`：仅 OpenRouter
- `MiniMax M2.5`：仅 OpenRouter

## 说明

- 这个仓库的环境变量只写在 README 里。
- 不提供 `.env.example`。
- Web Search 这部分暂时还没并入新的 provider 抽象，这次重构只处理大模型主链路。
