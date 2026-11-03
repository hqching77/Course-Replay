# Course Replay Backend

FastAPI、SQLAlchemy 与 SQLite 构成的 Course Replay MVP 后端。

## 当前已实现

- 健康检查与 AI 配置状态。
- 课程创建、列表、读取和删除。
- PDF、PPTX、Markdown、TXT 上传。
- 后台文本提取和 chunk 建立。
- 文档状态、任务状态和抽取内容接口。
- 知识点、课堂重放、掌握度和学习产物的数据模型。
- CheapRouter OpenAI-compatible Provider。
- `POST /api/process` 整页视觉分析：图片直接输入，PDF 逐页渲染，PPTX/DOCX 转 PDF 后逐页输入，不使用 OCR。
- 用户账号：注册、登录、退出、修改昵称（`/api/auth/*`）。密码用 scrypt 加盐哈希，登录令牌只存 SHA-256 摘要，30 天滑动过期。
- 每个用户的学习数据存数据库（`/api/workspace`）：课程、小节、材料记录、AI 讲稿、AI 讲师对话、探索支线、掌握度，以及「上课中」的课堂提问与回答。不同用户的数据互相隔离。
- `POST /api/class/ask` 上课中即时问答：直接、简短地回答，结合「老师正在讲」和最近几次提问。
- 构建（`POST /api/process/start`）可以任意组合：直接上传的 `files`、之前 `POST /api/uploads` 存好的 `upload_ids`、上课中的 `transcript`（课堂转写）和 `class_questions`（课上提问）。AI 会把转写和提问整理进笔记，课上提问写成「课上疑问」小节。
- `POST /api/transcribe` 语音转文字：浏览器把录音按停顿切成几秒一段的 WAV 发过来，转发给 OpenAI 兼容的 `/audio/transcriptions` 接口。默认硅基流动 `FunAudioLLM/SenseVoiceSmall`（免费，国内可用）。
- `POST /api/ai/check` 真实调用一次对话模型，供「检查服务端配置」使用。
- 用户可以在设置里换成自己的 AI / 语音接口：浏览器通过 `X-AI-*` / `X-STT-*` 请求头带上地址、模型和 Key，服务端只转发、不存储；自定义地址必须是 https 且不能指向内网（`ALLOW_PRIVATE_PROVIDER_URLS=true` 可放开，仅限本地开发）。
- 请求头 `X-UI-Language: en` 时，AI 回答和生成的笔记使用英文。

## 启动

在仓库根目录运行：

    cd backend
    $env:UV_CACHE_DIR='.uv-cache'
    uv sync --extra test --python C:\Python314\python.exe
    uv run uvicorn app.main:app --reload --port 8001

Swagger UI 地址为 http://127.0.0.1:8001/docs 。

启用 AI 前，在仓库根目录 `.env` 填写 `OPENAI_API_KEY` 和 `OPENAI_CHAT_MODEL`。默认 Base URL 为 `https://cdn.cheaprouter.cc/v1`。

PPTX、DOCX 的完整视觉输入在 Windows 上可使用已安装的 Microsoft Office，其他环境使用 LibreOffice。两者都不存在时接口会返回明确错误，不会退化为只读取文字。

## 账号与数据库

- 默认使用 `DATABASE_URL=sqlite:///./data/course_replay.db`，首次启动自动建表（`users`、`auth_sessions`、`study_courses`、`study_sections`、`study_materials`、`study_messages`、`study_branches`、`class_questions`）。
- 多人共用服务器时建议 PostgreSQL：`uv sync --extra postgres`，再设置 `DATABASE_URL=postgresql+psycopg://user:password@host:5432/course_replay`。
- `AI_REQUIRES_LOGIN=true`（默认）时，`/api/process/start`、`/api/study/ask`、`/api/class/ask` 需要登录，避免匿名用户消耗 API Key。
- `ALLOW_REGISTRATION=false` 可关闭公开注册。
- 前端部署在别的域名（如 GitHub Pages）时，把该域名加入 `CORS_ORIGINS`，并在构建前端时设置 `VITE_API_BASE` 指向后端地址。
- `postgres://` / `postgresql://` 开头的地址（Neon、Supabase 等直接给的）会自动改用 psycopg 驱动。
- 加密：设置 `DATA_ENCRYPTION_KEY` 后，课程名、笔记、转写、提问、对话等内容用 AES-256-GCM 加密后才写入数据库（`app/crypto.py`）；旧的明文数据仍能读，下次保存时自动加密。`APP_ENV=production` 时没有密钥会拒绝启动。
- 上线部署（Docker 镜像、Render、香港服务器）见根目录 [DEPLOY.md](../DEPLOY.md)。

## 语音转文字（上课中）

- 「AI 与偏好设置」里的「测试语音识别」会用一小段测试音频真实调用一次接口（不需要麦克风），失败时显示服务商返回的原因和常见解决办法（例如国际版硅基流动 Key 要用 `https://api.siliconflow.com/v1`）。
- 上课时如果识别失败，只提示一次；录音先存在页面里，后台按 5 秒 → 60 秒逐步重试，恢复后自动补上转写。
- 修改 `.env` 里的 AI / 语音配置不需要重启后端。

在 `.env` 设置 `STT_API_KEY`（默认用硅基流动，在 cloud.siliconflow.cn 申请）。其他可选：

| 服务 | STT_BASE_URL | STT_MODEL | 价格 |
| --- | --- | --- | --- |
| 硅基流动（默认） | https://api.siliconflow.cn/v1 | FunAudioLLM/SenseVoiceSmall | 免费模型 |
| Groq | https://api.groq.com/openai/v1 | whisper-large-v3-turbo | $0.04/小时 |
| OpenAI | https://api.openai.com/v1 | gpt-4o-mini-transcribe | $0.003/分钟 |

也可以不配服务端，用户在设置里填自己的 Key，或选「浏览器内置」识别（免费，但 Chrome 的内置识别依赖 Google，国内网络一般用不了）。

## 测试

    cd backend
    .\.venv\Scripts\python.exe -m pytest -q

在 PostgreSQL 上跑同一套测试：设置 `TEST_DATABASE_URL=postgresql+psycopg://...` 后再运行 pytest。

测试不会调用真实付费 AI API。
