<div align="center">

# 🌌 Vectaix AI

### 开源 AI 工作空间 — 多模型、多专家、一个平台。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Forks](https://img.shields.io/github/forks/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=silver)](https://github.com/Noah-Wu66/Vectaix-AI/network/members)
[![Issues](https://img.shields.io/github/issues/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=orange)](https://github.com/Noah-Wu66/Vectaix-AI/issues)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

[English](./README.md) · **简体中文** · [日本語](./README.ja.md) · [한국어](./README.ko.md)

<br/>

> ⚠️ **早期版本声明** — 本项目正处于积极开发阶段，功能、API 和界面可能会频繁变动。我们承诺持续更新与改进，请点亮 Star 关注最新动态！

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />

</div>

---

## ✨ Vectaix AI 是什么？

Vectaix AI 是一个**开源 AI 工作空间**，专为 Vercel 云原生部署设计。它将全球顶尖的 AI 模型汇聚在一个统一界面下 — 支持官方接入，以及独创的多专家协作系统。

无论你需要 GPT-5.4 的快速回答、Claude Opus 4.6 的深度推理，还是想让多个 AI 专家辩论并综合结论 — Vectaix AI 都能满足你。

---

## 🎯 核心功能

<table>
<tr>
<td width="50%">

### 🤖 多模型对话
在一个工作空间中自由切换 8 个 AI 模型，每个对话可绑定不同模型。

### 🧠 Council 工作流
独创的多专家协作模式：GPT-5.4、Claude Opus 4.6、Gemini 3.1 Pro Preview 作为并行专家回答，Seed 2.0 Pro 负责综合总结。

### 🔌 官方接入
所有模型统一走官方 API 或官方部署，不再支持线路切换，配置更直接。

</td>
<td width="50%">

### 🌐 联网搜索与浏览
内置火山引擎搜索 API，支持高级过滤。完整的网页浏览会话，自动提取内容。

### 📎 文件上传与解析
支持上传图片、PDF、Word、Excel、代码文件等，通过 Vercel Sandbox 的 Python 运行时解析。

### 💭 思维链展示
实时流式展示模型的推理过程，让你透明地看到 AI 是如何思考的。

</td>
</tr>
</table>

<table>
<tr>
<td width="33%">

### 🔐 用户认证
邮箱/密码注册登录，JWT 令牌 + HttpOnly Cookie。支持管理员系统。

</td>
<td width="33%">

### 🤖 Agent 运行时
完整的 Agent 框架，包含指令引擎、工具注册表、协调器和状态序列化。

</td>
<td width="33%">

### 📱 PWA 支持
Web App Manifest，移动端适配。支持深色/浅色/跟随系统主题。

</td>
</tr>
</table>

---

## 🧩 支持的模型

| 模型 | 提供商 | 接入方式 | 特长 |
|:------|:--------|:---------|:-----|
| **GPT-5.4** | OpenAI | 官方 API | 通用智能、编程、分析 |
| **Claude Opus 4.6** | Anthropic | 官方 API | 深度推理、写作、安全 |
| **Gemini 3.1 Pro Preview** | Google | 官方 API | 多模态、长上下文 |
| **DeepSeek V3.2** | DeepSeek | 官方 API | 推理、数学、代码 |
| **Seed 2.0 Pro** | 字节跳动 | 官方 API | 中文语言、总结 |
| **MiMo** | Xiaomi | 官方部署 | 推理、小模型能力 |
| **MiniMax M2.5** | MiniMax | 官方 API | 多语言生成、代码 |
| **Council** | 多模型协作 | GPT + Claude + Gemini + Seed | 专家共识综合 |

---

## 🏗️ 技术栈

<table>
<tr>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=nextjs" width="48" height="48" alt="Next.js" /><br><sub>Next.js 16</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=react" width="48" height="48" alt="React" /><br><sub>React 19</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=tailwind" width="48" height="48" alt="Tailwind" /><br><sub>Tailwind CSS</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=mongodb" width="48" height="48" alt="MongoDB" /><br><sub>MongoDB</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=vercel" width="48" height="48" alt="Vercel" /><br><sub>Vercel</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=nodejs" width="48" height="48" alt="Node.js" /><br><sub>Node 24</sub><br></td>
<td align="center" width="96"><br><img src="https://skillicons.dev/icons?i=python" width="48" height="48" alt="Python" /><br><sub>Python 3.13</sub><br></td>
</tr>
</table>

| 层面 | 技术 |
|:-----|:-----|
| 框架 | Next.js 16 (App Router) |
| 前端 | React 19、Tailwind CSS 3.4、Ant Design 5、Framer Motion |
| 数据库 | MongoDB (Mongoose 8) |
| 认证 | JWT (jose)、bcryptjs、HttpOnly Cookie |
| 文件存储 | Vercel Blob |
| 沙箱 | @vercel/sandbox (Node 24 + Python 3.13) |
| AI SDK | @anthropic-ai/sdk、Gemini REST、OpenAI REST、火山引擎 Seed |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| 文档解析 | pdf-parse、mammoth、word-extractor、xlsx |

---

## 🚀 部署

Vectaix AI 专为 **Vercel Pro** 部署设计，不提供本地运行环境。

### 前置条件

- Vercel Pro 账户
- MongoDB 数据库（如 MongoDB Atlas）
- 所需 AI 提供商的 API 密钥

### 环境变量

| 变量 | 必填 | 用途 |
|:-----|:----:|:-----|
| `MONGO_URI` | ✅ | MongoDB 连接字符串 |
| `JWT_SECRET` | ✅ | 认证令牌签名密钥 |
| `ADMIN_EMAILS` | ❌ | 管理员邮箱列表（逗号分隔） |
| `OPENAI_API_KEY` | ✅ | OpenAI 官方 API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 官方 API |
| `GEMINI_API_KEY` | ✅ | Google Gemini 官方 API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 官方 API |
| `ARK_API_KEY` | ✅ | 字节跳动 Seed 官方 API |
| `MINIMAX_API_KEY` | ✅ | MiniMax 官方 API |
| `MINIMAX_MODEL_ID` | ❌ | MiniMax 模型 ID，默认 `MiniMax-M2.5` |
| `MIMO_API_BASE_URL` | ✅ | MiMo 官方部署服务地址，形如 `https://your-mimo-server/v1` |
| `MIMO_API_KEY` | ❌ | MiMo 部署服务密钥 |
| `MIMO_MODEL_ID` | ❌ | MiMo 部署模型 ID，默认 `XiaomiMiMo/MiMo-7B-RL-0530` |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | 联网搜索（暂时可选） |

> **注意：** 不提供 `.env.example` 文件。本 README 是环境变量配置的唯一参考来源。

---

## 📁 项目结构

```
vectaix-ai/
├── app/
│   ├── api/                  # 19 组 API 路由
│   │   ├── admin/            # 用户管理
│   │   ├── agent/            # Agent 运行时入口
│   │   ├── anthropic/        # Claude 直连
│   │   ├── auth/             # 登录 / 注册 / 改密
│   │   ├── council/          # 多模型 Council 工作流
│   │   ├── conversations/    # 对话 CRUD
│   │   ├── deepseek/         # DeepSeek 直连
│   │   ├── gemini/           # Gemini 直连
│   │   ├── openai/           # OpenAI 直连
│   │   ├── upload/           # 文件上传
│   │   └── ...               # 更多路由
│   ├── components/           # 20+ React 组件
│   ├── ChatApp.js            # 主聊天应用
│   ├── layout.js             # 根布局
│   └── globals.css           # 全局样式
├── lib/
│   ├── server/               # 服务端逻辑
│   │   ├── agent/            # Agent 框架（协调器、工具、状态）
│   │   ├── chat/             # 提供商适配器、官方 API
│   │   ├── search/           # 搜索提供商
│   │   ├── webBrowsing/      # 网页浏览系统
│   │   └── sandbox/          # Vercel Sandbox 集成
│   ├── client/               # 客户端工具与 Hooks
│   └── shared/               # 共享模型与配置
├── models/                   # Mongoose 数据模型
├── scripts/sandbox/          # Python 解析脚本
├── public/                   # 静态资源
└── vercel.json               # Vercel 配置与定时任务
```

---

## 🗺️ 路线图

- [x] 8 个 AI 模型的多模型对话
- [x] Council 多专家协作工作流
- [x] 官方接入
- [x] 联网搜索与网页浏览
- [x] 文件上传与文档解析
- [x] Agent 运行时框架
- [x] 思维链展示
- [x] PWA 支持
- [ ] 更多模型提供商
- [ ] 插件 / 扩展系统
- [ ] 语音输入与输出
- [ ] 协作工作空间
- [ ] 移动端原生应用
- [ ] 自托管 Docker 支持

---

## 🤝 参与贡献

欢迎任何形式的贡献！无论是 Bug 报告、功能建议还是 Pull Request，每一份帮助都很重要。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 发起 Pull Request

---

## 📄 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

---

<div align="center">

## ⭐ Star 趋势

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

<br/>
<br/>

**如果你觉得 Vectaix AI 有用，请给我们一个 ⭐**

<br/>

[![Star this repo](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=social)](https://github.com/Noah-Wu66/Vectaix-AI)

<br/>

---

<sub>用热情构建，以开源驱动。</sub>

</div>
