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
- 构建时可附带 `class_questions`（课上提问），AI 会在相关知识点里加「课上疑问」小节解答。

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

## 测试

    cd backend
    .\.venv\Scripts\python.exe -m pytest -q

在 PostgreSQL 上跑同一套测试：设置 `TEST_DATABASE_URL=postgresql+psycopg://...` 后再运行 pytest。

测试不会调用真实付费 AI API。
