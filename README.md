# Vectaix AI

这是一个部署在 Vercel 上的多模型 AI 聊天项目，前端是 `Next.js 14 App Router`，后端接口也写在同一个项目里，数据库使用 `MongoDB + Mongoose`。

它不是普通展示站，而是一个已经做成产品形态的 AI 聊天系统，包含：

- 多模型切换
- Agent 执行流
- Council 多专家会审
- 图片/文档上传
- 对话导入导出
- 用户注册登录
- 企业 SSO 登录
- 管理员用户管理
- 模型线路切换

## 1. 项目现在能做什么

### 普通聊天

项目首页直接进入聊天界面，支持这些模型：

- `Agent`
- `Council`
- `Gemini 3.0 Flash`
- `Gemini 3.1 Pro`
- `Claude Sonnet 4.6`
- `Claude Opus 4.6`
- `ChatGPT 5.4`
- `Seed 2.0 Pro`
- `DeepSeek V3.2`

其中：

- `Agent` 支持文档、规划、工具流、审批流、继续执行。
- `Council` 会把一个问题交给多个专家模型分别回答，再给出综合结果。
- 其它模型主要用于普通多轮聊天、图片输入、联网回答。

### 文件能力

项目接入了 `Vercel Blob`，支持上传：

- 图片：`jpg / jpeg / png / gif / webp`
- 文本与代码：`txt / md / json / py / js / ts / html / css / xml / yml / yaml / sql / sh / log / ini / conf`
- 文档：`pdf / doc / docx`
- 表格：`xls / xlsx / csv`

文件上传后，系统会把文件信息记录到数据库里。对于文档类文件，还会尝试提取文本内容，供 Agent 使用。

当前代码里有明确限制：

- 文档附件目前只开放给 `Agent`
- 单次最多选 `4` 个附件
- 不同类型文件有不同大小和内容长度限制

### 联网搜索

项目带有自动联网判断能力，搜索提供方目前是：

- `Perplexity`

逻辑不是“只要开了联网就一定搜索”，而是：

1. 先判断当前问题是否真的需要联网
2. 需要的话，再生成搜索词
3. 把检索结果整理后喂给模型继续回答

### 用户系统

已实现：

- 邮箱注册
- 邮箱登录
- 修改密码
- JWT 登录态
- 企业 SSO 登录

普通登录和注册都带了限流，密码也做了基础强度校验。

### 个人设置

用户可以在界面里设置或管理：

- 系统提示词
- 当前启用的提示词
- 头像
- 主题模式
- 字体大小
- 完成提示音音量
- 是否开启联网

### 数据管理

用户可以在界面里：

- 导出自己的全部对话和设置
- 导入之前导出的数据

导入时会先做结构校验，再整包覆盖当前用户的旧数据。

### 管理功能

管理员额外拥有：

- 查看用户列表
- 查看每个用户的对话数量
- 清理异常加密残留数据
- 切换 OpenAI / Opus 的上游线路

管理员身份不是写死在数据库里，而是通过环境变量 `ADMIN_EMAILS` 判断。

## 2. 技术栈

- 前端：`Next.js 14`、`React 18`
- 样式：`Tailwind CSS`、`Ant Design`
- 动画：`framer-motion`
- 数据库：`MongoDB`、`Mongoose`
- 鉴权：`jose` + `HTTP Only Cookie`
- 文件存储：`@vercel/blob`
- Markdown 渲染：`react-markdown`、`remark-gfm`、`remark-math`、`rehype-katex`、`rehype-highlight`
- 文档解析：`pdf-parse`、`mammoth`、`word-extractor`、`xlsx`

## 3. 项目结构

```text
app/
  api/                    所有后端接口
    admin/                管理员接口
    agent/                Agent 执行与继续/审批/取消
    anthropic/            Claude 对话接口
    auth/                 注册、登录、SSO、改密、当前用户
    bytedance/            Seed / 火山引擎相关接口
    chat/                 联网搜索与聊天工具函数
    conversations/        对话列表、详情、更新、删除
    council/              多专家会审模式
    cron/                 Vercel 定时任务
    data/                 导出 / 导入
    deepseek/             DeepSeek 对话接口
    files/                文件预处理与下载
    google/               Gemini 对话接口
    openai/               OpenAI 对话接口
    settings/             用户设置
    upload/               Blob 上传签名与落库
  components/             UI 组件
  ChatApp.js              聊天主应用

lib/
  client/                 前端状态、聊天请求、导出能力
  server/                 服务端业务逻辑
  shared/                 模型、附件、通用常量
  auth.js                 JWT 读写
  db.js                   Mongo 连接
  modelRoutes.js          模型线路配置

models/
  User.js
  UserSettings.js
  Conversation.js
  BlobFile.js
  AgentRun.js
  SystemConfig.js

public/
  audio/                  提示音
  icons/                  品牌图标
```

## 4. 关键数据表

### `User`

保存用户邮箱、加密后的密码、创建时间。

### `UserSettings`

按用户保存：

- 头像
- 自定义系统提示词
- 更新时间

### `Conversation`

保存：

- 所属用户
- 对话标题
- 当前模型
- 对话级设置
- 消息数组
- 置顶状态
- 更新时间

消息里不只是纯文本，还可能带：

- `parts`
- `citations`
- `thinkingTimeline`
- `councilExperts`
- `agentRun`

也就是说，这个项目已经支持“展示模型思考过程 / 搜索过程 / Agent 状态”。

### `BlobFile`

记录上传到 Vercel Blob 的文件，包括：

- 文件地址
- 原始文件名
- 类型
- 大小
- 分类
- 解析状态
- 提取出的文本

### `AgentRun`

这是 Agent 模式最关键的一张表，用来保存：

- 当前任务目标
- 执行状态
- 执行步骤
- 审批请求
- 引用来源
- 产物列表
- 错误信息
- 心跳时间
- 是否可继续执行

## 5. 主要接口说明

### 鉴权

- `POST /api/auth/register` 注册
- `POST /api/auth/login` 登录
- `GET /api/auth/me` 获取当前用户
- `POST /api/auth/change-password` 修改密码
- `GET /api/auth/enterprise` 企业登录换取站内登录态

### 聊天

- `POST /api/openai`
- `POST /api/anthropic`
- `POST /api/google`
- `POST /api/deepseek`
- `POST /api/bytedance`
- `POST /api/council`
- `POST /api/agent`

### Agent 运行控制

- `GET /api/agent/runs/[id]`
- `POST /api/agent/runs/[id]/action`

可处理的动作包括：

- `approve`
- `reject`
- `cancel`

### 对话

- `GET /api/conversations`
- `GET /api/conversations/[id]`
- `PUT /api/conversations/[id]`
- `DELETE /api/conversations/[id]`

### 用户设置

- `GET /api/settings`
- `POST /api/settings` 新建提示词
- `PATCH /api/settings` 修改提示词
- `DELETE /api/settings` 删除提示词
- `PUT /api/settings` 更新头像

### 文件与数据

- `POST /api/upload`
- `POST /api/data/import`
- `GET /api/data/export`
- `POST /api/files/prepare`
- `GET /api/files/download`

### 管理员

- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/model-routes`
- `PATCH /api/admin/model-routes`

## 6. 环境变量

下面这些变量是我根据项目代码实际扫出来的，不是猜的。

### 基础必备

- `MONGO_URI`
  - MongoDB 连接地址
- `JWT_SECRET`
  - 站内登录 JWT 密钥

### 模型相关

- `GEMINI_API_KEY`
  - Gemini 接口
- `DEEPSEEK_API_KEY`
  - DeepSeek 接口
- `ARK_API_KEY`
  - 火山引擎 / Seed / Agent 运行所需
- `RIGHT_CODES_API_KEY`
  - OpenAI 默认线路密钥
- `RIGHT_CODES_OPENAI_BASE_URL`
  - OpenAI 默认线路地址，不配时会走代码里的默认值
- `AIGOCODE_API_KEY`
  - Claude Opus 默认线路密钥
- `ZENMUX_API_KEY`
  - 管理员切到 `zenmux` 线路时使用
- `PERPLEXITY_API_KEY`
  - 联网搜索

### 权限与后台

- `ADMIN_EMAILS`
  - 管理员邮箱白名单，多个用英文逗号分隔
- `OA_SSO_SECRET`
  - 企业 SSO 校验密钥

### 定时任务

- `CRON_SECRET`
  - 保护 `/api/cron/cleanup-blobs`

## 7. Vercel 相关

项目已经写了 `vercel.json`，当前 cron 表达式是：

- `0 3 * * *` -> 定时调用 `/api/cron/cleanup-blobs`

这个任务会做两件事：

1. 清理过期的 Blob 文件
2. 把长时间卡住的 Agent 任务改成“可继续执行”状态

另外，项目 `package.json` 里声明了：

- `Node.js 24.x`

## 8. 安全与限制

项目里已经做了这些保护：

- 中间件动态生成 `CSP Nonce`
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `HSTS`
- `Referrer-Policy`
- 登录/注册/聊天/导入导出/上传限流
- 文件类型白名单
- 文档解析大小限制
- 管理员邮箱白名单

## 9. 本地与线上说明

这个项目明显是按“Vercel 线上部署”来维护的。

从代码上看，本地当然也保留了标准脚本：

- `dev`
- `build`
- `start`
- `lint`

但就目前项目习惯来说，更适合把它理解成：

- 前端、接口、定时任务都跑在 Vercel
- MongoDB 和 Blob 都是线上资源
- 真正需要关心的是 Vercel 环境变量是否齐全

## 10. 适合继续维护时优先看哪里

如果后面要继续改这个项目，最值得先看的文件是：

- `app/ChatApp.js`
  - 前端聊天主入口
- `lib/client/chat/chatClient.js`
  - 前端请求流、流式返回、消息拼接
- `lib/shared/models.js`
  - 模型列表与能力定义
- `app/api/agent/route.js`
  - Agent 模式入口
- `lib/server/agent/runtimeV2.js`
  - Agent 核心执行逻辑
- `app/api/council/route.js`
  - 多专家会审逻辑
- `lib/server/files/service.js`
  - 文档解析与附件准备
- `lib/modelRoutes.js`
  - OpenAI / Opus 上游线路切换

## 11. 一句话总结

`Vectaix AI` 已经不是简单的聊天壳子，而是一个集成了多模型、Agent、文件理解、联网搜索、用户系统、管理员后台和 Vercel 定时清理任务的完整 AI Web 应用。
