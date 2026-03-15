# Vectaix AI

一个部署在 Vercel 上的多模型 AI 聊天应用，前端、后端接口、定时任务都在同一个 `Next.js 16 App Router` 项目里。

这不是单纯的聊天壳子，而是已经做成产品形态的一套 AI Web 应用，包含多模型切换、Agent 执行流、Council 多专家会审、文件上传解析、用户系统、管理员后台、数据导入导出等完整能力。

> 这份 README 已按当前仓库代码重新核对，内容以现在这份代码为准。

## 核心能力

- 多模型聊天：支持 OpenAI、Claude、Gemini、Seed、DeepSeek 等线路。
- Agent 模式：支持规划、工具执行、审批、继续执行、会话记忆。
- Council 模式：让多个专家模型分别回答，再给出综合结果。
- 文件能力：支持图片、文本、代码、PDF、Word、Excel、CSV 等附件。
- 联网搜索：按问题自动判断是否需要搜索，再把结果整理给模型。
- 用户系统：注册、登录、退出、改密、企业 SSO。
- 个人设置：头像、系统提示词、主题、字号、联网开关等。
- 管理后台：用户管理、异常加密数据清理、模型线路切换、Agent 沙箱重置。
- 数据迁移：导出当前账号的对话和设置，再导入回来。

## 当前支持的模型

| 模型 | 图片 | 文档附件 | 联网 | Agent 流程 | 会话记忆 |
| --- | --- | --- | --- | --- | --- |
| `Agent` | 支持 | 支持 | 支持 | 支持 | 支持 |
| `Council` | 支持 | 不支持 | 不支持 | 不支持 | 不支持 |
| `Gemini 3.0 Flash` | 支持 | 不支持 | 支持 | 不支持 | 不支持 |
| `Gemini 3.1 Pro` | 支持 | 不支持 | 支持 | 不支持 | 不支持 |
| `Claude Sonnet 4.6` | 支持 | 不支持 | 支持 | 不支持 | 不支持 |
| `Claude Opus 4.6` | 支持 | 不支持 | 支持 | 不支持 | 不支持 |
| `ChatGPT 5.4` | 支持 | 不支持 | 支持 | 不支持 | 不支持 |
| `Seed 2.0 Pro` | 支持 | 不支持 | 支持 | 不支持 | 不支持 |
| `DeepSeek V3.2` | 不支持 | 不支持 | 支持 | 不支持 | 不支持 |

默认模型是 `DeepSeek V3.2`。

## 文件与附件规则

### 支持的上传类型

- 图片：`jpg`、`jpeg`、`png`、`gif`、`webp`
- 文本：`txt`、`md`、`markdown`、`log`
- 代码：`py`、`js`、`mjs`、`cjs`、`ts`、`tsx`、`jsx`、`html`、`css`、`xml`、`yml`、`yaml`、`sql`、`sh`、`ini`、`conf`
- 数据：`json`
- 文档：`pdf`、`doc`、`docx`
- 表格：`xls`、`xlsx`、`csv`

### 当前限制

- 非图片文档附件目前只开放给 `Agent`
- 单次聊天最多上传 `5` 个附件
- 图片最大 `20MB`
- 文本和代码最大 `2MB`
- PDF / Word 最大 `15MB`
- Excel / CSV / 表格类最大 `10MB`
- PDF 最多 `120` 页
- 表格最多 `10` 个工作表，并限制总行数、列数、单元格数量

上传后的文件会先记到 `MongoDB`，文件本体存到 `Vercel Blob`。  
文档解析和 Agent 运行会用到 `Vercel Sandbox`。

## 项目结构

```text
app/
  api/
    admin/                  管理员接口
    agent/                  Agent 入口、运行状态、审批/取消
    anthropic/              Claude 对话
    auth/                   注册、登录、退出、改密、SSO、当前用户
    bytedance/              Seed / 火山引擎对话
    chat/                   联网搜索、历史压缩等聊天辅助接口
    conversations/          对话列表、详情、更新、删除
    council/                多专家会审
    cron/                   Vercel 定时任务
    data/                   导出 / 导入
    deepseek/               DeepSeek 对话
    files/                  文档准备、文件下载
    google/                 Gemini 对话
    images/                 图片下载
    openai/                 OpenAI 对话
    settings/               用户设置
    upload/                 Blob 上传签名与落库
  components/               UI 组件
  ChatApp.js                聊天主应用
  layout.js                 根布局
  page.js                   首页

lib/
  client/                   前端请求、状态、导出、Hook
  server/
    agent/                  Agent 运行时
    chat/                   联网搜索配置与策略
    conversations/          对话清洗与服务
    data/                   导入导出逻辑
    files/                  文档解析与附件准备
    sandbox/                Vercel Sandbox 封装
    seed/                   Seed 服务逻辑
    settings/               用户设置服务
  shared/                   模型定义、附件规则、共享常量
  admin.js                  管理员权限判断
  auth.js                   JWT 与 Cookie
  db.js                     MongoDB 连接
  modelRoutes.js            OpenAI / Opus 上游线路配置
  rateLimit.js              简单限流

models/
  AgentRun.js
  BlobFile.js
  Conversation.js
  MemoryEntry.js
  SystemConfig.js
  User.js
  UserSettings.js

public/
  audio/                    提示音
  icons/                    图标资源

scripts/
  sandbox/parse_attachment.py

proxy.js                    CSP、安全头、Nonce
vercel.json                 Vercel cron 配置
```

## 主要数据表

### `User`

保存用户邮箱、密码哈希、创建时间。

### `UserSettings`

按用户保存个人设置，例如：

- 头像
- 系统提示词列表
- 当前启用的提示词
- 主题模式
- 字体大小
- 联网开关

### `Conversation`

保存每一条对话，包括：

- 所属用户
- 标题
- 当前模型
- 消息数组
- 对话级设置
- 置顶状态
- 更新时间

消息里不只是纯文本，还可能带：

- `parts`
- `citations`
- `thinkingTimeline`
- `councilExperts`
- `agentRun`

### `BlobFile`

记录上传文件的信息，例如：

- 文件地址
- 原始文件名
- 类型
- 大小
- 分类
- 解析状态
- 提取出的文本
- 视觉资产信息

### `AgentRun`

保存 Agent 执行过程，包括：

- 当前目标
- 执行状态
- 步骤列表
- 审批请求
- 最终回答
- 错误信息
- 产物列表
- 沙箱会话
- 是否可继续执行

### `MemoryEntry`

保存 Agent 的会话记忆摘要，用来让后续任务接上之前的上下文。

### `SystemConfig`

保存系统级配置，目前主要用于模型线路切换。

## 常用接口

下面这部分只列最常用、最值得先看的接口。

### 鉴权

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `DELETE /api/auth/me`
- `POST /api/auth/change-password`
- `GET /api/auth/enterprise`

### 聊天

- `POST /api/openai`
- `POST /api/anthropic`
- `POST /api/google`
- `POST /api/deepseek`
- `POST /api/bytedance`
- `POST /api/council`
- `POST /api/agent`
- `POST /api/chat/compress`

### 对话与附件

- `GET /api/conversations`
- `GET /api/conversations/[id]`
- `PUT /api/conversations/[id]`
- `DELETE /api/conversations/[id]`
- `POST /api/upload`
- `GET /api/files/download`
- `GET /api/images/download`

### Agent 控制

- `POST /api/agent/runs/[id]/action`

其中动作支持：

- `approve`
- `reject`
- `cancel`

### 数据导入导出

- `GET /api/data/export`
- `POST /api/data/import`

### 管理员

- `GET /api/admin/users`
- `POST /api/admin/users`
- `POST /api/admin/users/[id]`
- `PATCH /api/admin/users/[id]`
- `DELETE /api/admin/users/[id]`
- `GET /api/admin/model-routes`
- `PATCH /api/admin/model-routes`
- `GET /api/admin/agent-sandbox`
- `POST /api/admin/agent-sandbox`

### 定时任务

- `GET /api/cron/cleanup-blobs`

## 环境变量

下面这些变量是按当前代码实际扫描出来的。

### 必填

- `MONGO_URI`
  - MongoDB 连接地址
- `JWT_SECRET`
  - 站内登录 JWT 密钥
- `GEMINI_API_KEY`
  - Gemini 对话和历史压缩都会用到
- `DEEPSEEK_API_KEY`
  - DeepSeek 对话
- `ARK_API_KEY`
  - Seed 对话和 Agent 运行
- `RIGHT_CODES_API_KEY`
  - OpenAI 默认线路
- `AIGOCODE_API_KEY`
  - Claude Opus 默认线路
- `PERPLEXITY_API_KEY`
  - 联网搜索

### 按功能启用

- `RIGHT_CODES_OPENAI_BASE_URL`
  - OpenAI 默认线路地址，不填时会走代码里的默认地址
- `ZENMUX_API_KEY`
  - 管理员把 OpenAI 或 Opus 切到 `zenmux` 线路时使用
- `ADMIN_EMAILS`
  - 管理员邮箱白名单，多个邮箱用英文逗号分隔
- `OA_SSO_SECRET`
  - 企业 SSO 校验密钥
- `CRON_SECRET`
  - 保护 `/api/cron/cleanup-blobs`

## 部署说明

这个项目明显是按 Vercel 部署方式维护的，重点不是本地起服务，而是线上资源是否配置完整。

- 部署平台：`Vercel`
- Node 版本：`24.x`
- 定时任务配置文件：`vercel.json`
- 当前 cron：`0 3 * * *`

这个定时任务会做两件事：

1. 清理过期或失效的 Blob 文件
2. 把长时间卡住的 Agent 任务恢复成可继续状态

## 安全与限制

项目当前已经做了这些保护：

- 中间件动态生成 `CSP Nonce`
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security`
- `Referrer-Policy`
- `Permissions-Policy`
- 登录、注册、聊天压缩、导入导出、上传等接口限流
- 文件扩展名和 MIME 类型双重校验
- 管理员邮箱白名单

## 适合优先阅读的文件

如果后面继续维护这个项目，建议先看这些文件：

- `app/ChatApp.js`
  - 前端聊天主入口
- `lib/client/chat/chatClient.js`
  - 前端聊天请求、流式返回、消息拼接
- `lib/shared/models.js`
  - 模型列表和能力定义
- `app/api/agent/route.js`
  - Agent 模式主入口
- `lib/server/agent/runtimeV2.js`
  - Agent 核心执行逻辑
- `app/api/council/route.js`
  - Council 多专家会审逻辑
- `lib/server/files/service.js`
  - 文档解析和附件准备
- `lib/server/sandbox/vercelSandbox.js`
  - Vercel Sandbox 交互封装
- `lib/modelRoutes.js`
  - OpenAI / Claude Opus 上游线路切换

## 一句话总结

`Vectaix AI` 是一个完整的 AI Web 应用，不只是“接个模型接口的聊天页”，而是把多模型、Agent、记忆、文件解析、联网搜索、用户系统、管理员后台和 Vercel 线上能力都整合到了一起。
