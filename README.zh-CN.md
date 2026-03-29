<div align="center">

# 🌌 Vectaix AI

### 开源 AI 工作空间 — 基于多专家议会与自治 Agent 的双引擎架构

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Noah-Wu66/Vectaix-AI?style=for-the-badge&logo=github&color=gold)](https://github.com/Noah-Wu66/Vectaix-AI/stargazers)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![Node](https://img.shields.io/badge/Node-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

[English](./README.md) · **简体中文** · [日本語](./README.ja.md) · [한국어](./README.ko.md)

[📄 阅读技术架构白皮书 (Architecture Paper)](./ARCHITECTURE.md)

<br/>

> ⚠️ **早期版本声明** — 本项目正处于积极开发阶段，功能、API 和界面可能会频繁变动。请点亮 Star 关注最新动态！

<br/>

<img src="https://img.shields.io/badge/GPT--5.4-412991?style=flat-square&logo=openai&logoColor=white" alt="GPT-5.4" />
<img src="https://img.shields.io/badge/Claude_Opus_4.6-d97706?style=flat-square&logo=anthropic&logoColor=white" alt="Claude" />
<img src="https://img.shields.io/badge/Gemini_3.1_Pro_Preview-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini" />
<img src="https://img.shields.io/badge/DeepSeek_V3.2-0A0A0A?style=flat-square&logoColor=white" alt="DeepSeek" />
<img src="https://img.shields.io/badge/Seed_2.0_Pro-FF6A00?style=flat-square&logoColor=white" alt="Seed" />

</div>

---

## ✨ Vectaix AI 是什么？

Vectaix AI 是一个**开源 AI 工作空间**，专为 Vercel 云原生部署设计。它将全球顶尖的 AI 模型汇聚在一个统一界面下，并由严谨的 [双引擎架构 (Dual-Engine Architecture)](./ARCHITECTURE.zh-CN.md) 驱动。

无论你需要 GPT-5.4 的快速回答、Claude Opus 4.6 的深度推理，还是想让多个 AI 专家辩论并综合出一个完美答案，Vectaix AI 都能为你提供高度打磨的专业体验。

### 🖼️ 界面预览

*(在此处插入聊天界面截图或演示 GIF)*

---

## 🎯 核心功能

<table>
<tr>
<td width="50%">

### 🧠 Council 工作流 (多专家共识)
独创的协作模式：多个模型 (如 GPT, Claude, Gemini) 作为并行专家对问题进行推理，最后由一个主模型进行共识综合。
[阅读数学原理与架构图](./ARCHITECTURE.md#11-the-council-module-multi-expert-consensus)

### 🤖 Agent 运行时
一个完全隔离的编排层，包含指令引擎、工具注册表和状态序列化，用于自主执行复杂任务。
[查看 Agent 架构图](./ARCHITECTURE.md#12-the-agent-module-autonomous-orchestration)

### 🔌 官方 API 统一接入
所有模型均通过官方 API 或官方部署节点接入，告别第三方中转的极度不稳定，确保最佳能力表现。

</td>
<td width="50%">

### 🌐 联网搜索与浏览
内置火山引擎搜索 API 提供 Grounded 生成支持，包含完整的网页浏览会话和内容提取。

### 📎 多模态文档解析
支持上传图片、PDF、Word、Excel 和代码文件。通过 Vercel Sandbox (Python 运行时) 异步安全解析。

### 💭 实时思维链展示
实时流式展示模型的内部推理过程，让你透明地看到 AI 是如何一步步得出结论的。

</td>
</tr>
</table>

---

## 🏗️ 技术栈矩阵

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

---

## 🚀 部署指南

Vectaix AI 专为 **Vercel Pro** Serverless 部署设计，无需维护服务器即可享受高并发计算与弹性扩容。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNoah-Wu66%2FVectaix-AI)

### 环境变量

| 变量 | 必须 | 用途 |
|:-----|:----:|:-----|
| `MONGO_URI` | ✅ | MongoDB 连接字符串，用于存储状态记忆 |
| `JWT_SECRET` | ✅ | 用于会话校验的加密签名密钥 |
| `ADMIN_EMAILS` | ❌ | 系统高权限管理员邮箱列表 (逗号分隔) |
| `OPENAI_API_KEY` | ✅ | OpenAI 官方 API |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 官方 API |
| `GEMINI_API_KEY` | ✅ | Google Gemini 官方 API |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek 官方 API |
| `ARK_API_KEY` | ✅ | 字节跳动 Seed 官方 API |
| `MINIMAX_API_KEY` | ✅ | MiniMax 官方 API |
| `MIMO_API_BASE_URL` | ✅ | MiMo 部署节点地址 |
| `VOLCENGINE_WEB_SEARCH_API_KEY` | ⬚ | 网页搜索支持 |

---

## 🗺️ 路线图 (Roadmap)

- [x] 8 个顶尖模型的统一聊天界面
- [x] 双引擎架构：Council 议会工作流 & Agent 运行时
- [x] 联网搜索与多模态文档解析
- [x] 实时思维链 (Thinking Blocks) 展示
- [ ] 插件 / 扩展系统
- [ ] 多人协作工作空间
- [ ] 自托管 Docker 支持

---

## 🤝 参与贡献与开源许可

欢迎任何形式的贡献！无论是 Bug 报告、功能建议还是 Pull Request，每一份帮助都很重要。

本项目基于 [MIT 许可证](LICENSE) 开源。

<div align="center">

## ⭐ Star 趋势

<a href="https://star-history.com/#Noah-Wu66/Vectaix-AI&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Noah-Wu66/Vectaix-AI&type=Date" />
 </picture>
</a>

</div>