
# Course Replay 初步开发主 Prompt

> **当前初版**：已整合 React 前端与队友的 FastAPI 后端。上传图片时直接交给视觉模型；PDF 会渲染为逐页图片；PPTX/DOCX 会先用 LibreOffice 转为 PDF，再将完整页面交给模型，全程不执行 OCR。普通演示数据保存在浏览器 `localStorage`，真实材料分析通过 CheapRouter 完成。
>
> ```bash
> npm install
> # 终端 1：启动后端
> cd backend
> uv sync --extra test
> uv run uvicorn app.main:app --reload --port 8001
>
> # 终端 2：启动前端
> npm run dev
> # 生产构建：npm run build
> ```
>
> 在根目录 `.env` 中填写 `OPENAI_API_KEY` 和 `OPENAI_CHAT_MODEL`。`OPENAI_BASE_URL` 已配置为 `https://cdn.cheaprouter.cc/v1`；`.env` 已被 Git 忽略。
>
> 前端地址：http://127.0.0.1:5173；后端地址：http://127.0.0.1:8001。前端通过 `/api` 代理连接后端，浏览器旧课程数据会自动兼容读取。

使用方式：把本文“Prompt 正文”完整交给 Codex、Claude Code、Cursor Agent 等可读写仓库的编码 Agent，并让它在 Course-Replay 仓库根目录执行。

---

## Prompt 正文

你是一名资深全栈工程师、AI 应用架构师和教育产品设计师。请在当前仓库中从零构建名为 Course Replay 的可运行 MVP，以可维护、可测试、可部署到 GitHub 的工程代码作为交付物。

### 1. 背景与约束

Course Replay 面向大学课程学习。用户按课程上传课件、笔记、手写笔记照片、板书照片等材料，系统解析并建立课程知识库，提供“课堂重放、知识点交互、掌握度判断、针对性复习”的完整闭环。

参考项目路径：G:\学习\THU\项目\EE-Hackathon\nano-NotebookLM

目标仓库：https://github.com/hqching77/Course-Replay.git

参考项目仅用于理解 FastAPI、文档解析、RAG、页级引用、知识图谱、题目生成和掌握度跟踪等工程思路。不要沿用其品牌、名称、视觉资产或页面文案。若复制 Apache-2.0 代码，必须保留相应版权和许可证声明；优先围绕 Course Replay 的目标重新组织实现。

产品界面和默认输出以简体中文为主，代码、API 字段和内部标识使用清晰英文。

### 2. 用户主流程

围绕以下流程设计页面、数据状态和 API：

1. 创建或选择课程：课程包含名称、描述和标签；首页展示材料数、处理状态、最近学习时间和总体掌握度。
2. 导入课堂记录：批量上传 PDF、PPTX、DOCX、Markdown、TXT、PNG、JPG、JPEG；展示文件信息、解析阶段、进度和失败原因；预留文本粘贴入口。
3. 开始课堂重放：不是音视频回放，而是 AI 根据材料顺序、页码或幻灯片顺序、知识依赖关系生成逐步讲解流程。页面包含课程路径、材料预览、AI 教师交互区。
4. 选择知识点：显示定义、公式、课程证据、前置知识、关联知识和可点击来源引用。
5. 回答互动问题：支持选择题、简答题和“用自己的话解释”；AI 返回评价、答案、理由、材料依据及掌握度变化，并区分真正理解、猜对和知识缺口。
6. 答错后补基础或讲原因：沿前置知识分支提出更基础问题，或用解释、反例、类比和例题帮助理解。
7. 自由探索：用户可针对课件、笔记、回答或知识点追问；AI 区分课程材料内容和补充背景知识。
8. 返回或继续探索：明确当前位置、探索深度和返回主线入口，可保存分支稍后学习。
9. 继续课程：回到离开前的授课节点并自动保存进度，刷新后可恢复。
10. 生成复习题单：选择范围、题型、难度和复习时间，结合薄弱点、错题和必会标记生成题目、答案和解析。
11. 生成 Cheatsheet：按整节课或知识范围生成一页纸风格总结，含核心定义、公式、易错点、知识联系和引用。
12. 查看学习记录：显示掌握度、薄弱点、探索分支、错题、复习记录和最近活动，并可跳回对应内容。

### 3. MVP 优先级

必须完成一条真实可用的纵向链路：

创建课程 → 上传材料 → 后台解析 → 建立索引 → 生成课程路径 → 开始课堂重放 → 回答问题 → 更新掌握度 → 生成题单或 Cheatsheet → 查看学习记录。

P0，本轮必须完成：

- 课程创建、列表、查看、删除。
- PDF、PPTX、DOCX、MD、TXT 上传与文本提取。
- PNG/JPG 上传和可插拔 OCR 接口。没有 OCR 服务时保留文件并显示“等待 OCR 配置”，不得伪造结果。
- 后台文件处理任务及可轮询的分阶段进度。
- 文档分块、来源元数据、课程内检索。
- OpenAI-compatible Provider，可配置 API Key、Base URL、Chat Model、Embedding Model。
- API Key 只从服务端环境变量读取，不发送到浏览器、日志或 Git。
- 持久化嵌入向量；可增加关键词检索并做简单融合。
- AI 回答带来源文件及页码或幻灯片引用。
- 课程路径或知识点树，以及基于知识点的课堂重放。
- 互动问题、答案评价、掌握度更新。
- 自由追问、探索分支和返回主线。
- 复习题单、Cheatsheet、学习记录。
- 自动保存和恢复学习进度。
- 基础测试、README、.env.example、Dockerfile、docker-compose 和 GitHub Actions。

P1，仅预留结构或时间允许再做：完整 OCR、可编辑力导向知识图谱、SSE 流式回答、PDF 导出、错题变体、多 Provider UI、跨课程关联。

本轮不做：用户注册、多人协作、复杂权限、真实音视频回放、语音合成、移动原生 App、云对象存储、分布式队列、支付订阅。

### 4. 建议技术架构

若仓库尚无合理技术栈，采用：

后端：Python 3.11+、FastAPI、Uvicorn、Pydantic v2、SQLAlchemy 2、SQLite、Alembic。数据库层应易于迁移 PostgreSQL。上传文件和派生文件保存到环境变量指定的本地目录。使用 PyMuPDF、python-pptx、python-docx 解析材料。后台任务 MVP 可用 BackgroundTasks 或进程内 asyncio task，但状态必须持久化，接口应便于以后替换为 Celery 或 RQ。

前端：React、TypeScript、Vite、React Router、TanStack Query。可用 Zustand 或精简 Context 管理重放状态。使用 Tailwind CSS 或 CSS Modules，Markdown 与 KaTeX 渲染公式，PDF.js 或浏览器预览 PDF。PPTX MVP 可显示提取文本和缩略占位。

AI：使用 OpenAI Python SDK 接入用户提供的 OpenAI-compatible API。实现统一 Provider 抽象，至少含 chat、embed，可选 vision，并统一超时、重试、错误和 token 统计。

检索：每个 chunk 保存 course_id、document_id、source_file、page、slide、section、text、hash。向量需持久化，选择 Windows 与 Docker 都容易运行且依赖合理的本地方案，例如 FAISS 或 Chroma。关键词检索可用 SQLite FTS5 或 BM25。检索默认严格限定 course_id。

### 5. 环境配置

提供下列 .env.example，但不填写真实密钥：

    OPENAI_API_KEY=
    OPENAI_BASE_URL=https://api.openai.com/v1
    OPENAI_CHAT_MODEL=
    OPENAI_EMBEDDING_MODEL=
    OPENAI_VISION_MODEL=
    DATABASE_URL=sqlite:///./data/course_replay.db
    ARTIFACTS_DIR=./data/artifacts
    MAX_UPLOAD_MB=100

不要硬编码模型名称。若必需模型未配置，启动时和 UI 中明确提示，不允许静默调用可能不存在或产生费用的默认模型。

知识点提取、课程路径、问题生成、答案评价、题单和 Cheatsheet 等需要稳定结构的操作必须经过 Pydantic 校验。若 Provider 不支持原生 structured output，则要求 JSON 并在服务端解析、校验和有限重试。AI 失败必须返回真实错误，不得伪造成功数据。

### 6. 核心数据模型

至少包含以下实体及关键关系：

- Course：id、name、description、tags、status、created_at、updated_at。
- Document：id、course_id、filename、stored_path、file_type、sha256、status、total_pages、error、created_at。
- ProcessingTask：id、course_id、document_id、stage、progress、message、status、error、时间戳。
- Chunk：id、course_id、document_id、text、page、slide、section、source_location、embedding_ref。
- KnowledgeNode：id、course_id、title、definition、node_type、depth、learning_order、source_chunk_ids。
- KnowledgeEdge：source_id、target_id、relation_type。
- ReplaySession：id、course_id、current_node_id、current_step、status、started_at、updated_at。
- ExplorationBranch：id、session_id、parent_node_id、question、depth、status、created_at。
- Question：id、course_id、knowledge_node_id、question_type、prompt、choices、answer、explanation、difficulty、source_chunk_ids。
- Attempt：id、question_id、session_id、user_answer、score、evaluation、guessed、created_at。
- MasteryRecord：course_id、knowledge_node_id、score、attempts、correct_attempts、last_tested_at、weak_reason。
- StudyArtifact：id、course_id、artifact_type、title、content_markdown、scope_json、created_at。

掌握度 MVP 使用透明规则并保存变化原因。例如：初始 0；正确且解释充分加 0.15；正确但疑似猜测加 0.05；错误减 0.08；限制在 0 到 1。保存更新前后数值和理由，方便以后替换算法。

### 7. 最低 API 范围

实现 REST API 和 OpenAPI 文档，至少覆盖：

    GET    /api/health
    GET    /api/courses
    POST   /api/courses
    GET    /api/courses/{course_id}
    DELETE /api/courses/{course_id}
    POST   /api/courses/{course_id}/documents
    GET    /api/courses/{course_id}/documents
    GET    /api/tasks/{task_id}
    GET    /api/documents/{document_id}/content
    POST   /api/courses/{course_id}/knowledge/build
    GET    /api/courses/{course_id}/knowledge
    POST   /api/courses/{course_id}/search
    POST   /api/courses/{course_id}/replay/start
    GET    /api/replay/{session_id}
    POST   /api/replay/{session_id}/next
    POST   /api/replay/{session_id}/return
    POST   /api/replay/{session_id}/ask
    POST   /api/replay/{session_id}/questions/generate
    POST   /api/replay/{session_id}/questions/{question_id}/submit
    GET    /api/courses/{course_id}/mastery
    GET    /api/courses/{course_id}/study-records
    POST   /api/courses/{course_id}/artifacts/review-sheet
    POST   /api/courses/{course_id}/artifacts/cheatsheet
    GET    /api/courses/{course_id}/artifacts

所有 ID 使用 UUID。严格验证输入长度、类型、扩展名、MIME 和文件大小。服务端生成磁盘文件名，阻止路径穿越、危险压缩包和不受控远程 URL。

### 8. 页面和交互

至少实现：

- / ：课程仪表盘。
- /courses/:courseId ：课程详情与材料管理。
- /courses/:courseId/replay ：课堂重放。
- /courses/:courseId/review ：题单和 Cheatsheet。
- /courses/:courseId/progress ：我的学习。
- /settings ：AI 配置状态；不显示完整 API Key。

课堂重放页采用三栏或响应式布局：左侧课程主线、知识点树、掌握度和当前位置；中间文件及页码或幻灯片预览；右侧 AI 讲解、作答、反馈和追问。

必须有空状态、上传中、解析中、索引中、AI 生成中、成功、部分成功、失败、未配置 API、无检索内容和可重试状态。不要用无限加载掩盖错误。

视觉应现代、克制、适合长时间学习，可使用深色或中性色，突出主线、当前知识点、引用和掌握度，但不得照搬参考项目 UI。

### 9. RAG 与引用规则

- 回答前按 course_id 检索相关 chunks。
- 明确要求 AI 只将检索材料称为课程材料依据。
- 输出区分“课程材料中的解释”和“补充理解”。
- 关键结论带 citation id，服务端映射为文件、页码或幻灯片、chunk id。
- 材料不足时明确说明依据不足；可提供标记清晰的背景知识，但不能冒充课件内容。
- citation 必须可通过 API 读取真实 chunk，并在 UI 跳转或高亮。

### 10. 开发顺序

先阅读当前仓库和参考项目，输出不超过 20 行的实施计划，然后直接编码，不停留在方案讨论。

1. 初始化目录、依赖、配置、数据库和健康检查。
2. 实现课程与文件上传，先完成第一个可观察的前后端纵向功能。
3. 实现解析、chunk、后台任务和进度 UI。
4. 实现 Provider、embedding、课程内检索和带引用问答。
5. 实现知识路径和课堂重放。
6. 实现互动问题、答案评价、掌握度和探索分支。
7. 实现题单、Cheatsheet 和学习记录。
8. 添加测试、Docker、CI、README。
9. 执行测试和构建，修复问题，汇报完成项、未完成项和启动命令。

每完成一个阶段都运行对应测试。P1 可保留清晰接口或 TODO，但 P0 主链路必须真实工作。

### 11. 测试与验收

自动测试至少覆盖：文件类型和大小校验、SHA256 去重、五类文本材料解析、chunk 来源位置、无 API Key 时仍可管理课程和解析材料、mock Provider、课程隔离检索、citation 映射、掌握度边界、重放保存恢复、失败重试。测试不依赖真实付费 API。

必须实际通过后端 pytest、前端类型检查和生产构建；Docker 镜像可构建。

人工验收场景：创建“数字电路”课程；上传一个 PDF 和一个 PPTX；观察分阶段进度；进入课堂重放并查看知识路径和来源；回答问题并看到掌握度变化；进入补基础或“为什么”分支再返回主线；刷新后恢复进度；生成题单和 Cheatsheet；在“我的学习”看到薄弱点、错题和活动。

### 12. 安全与隐私

- .env、密钥、数据库、上传文件、索引和生成结果默认加入 .gitignore。
- API Key 不得进入客户端代码或日志；认证头和敏感数据需脱敏。
- 上传路径由服务端生成，限制类型和大小，不执行宏、脚本或嵌入对象。
- AI 输出视为不可信输入，Markdown 渲染必须清理 HTML。
- 不允许提交虚假 AI 分析结果。mock Provider 只能用于开发和测试并清晰标识。

### 13. GitHub 交付

仓库包含 README、.env.example、.gitignore、Dockerfile、docker-compose.yml、.github/workflows/ci.yml、前后端测试。README 需包含简介、架构、功能截图占位、快速启动、配置、测试和 Docker 说明。

若用户未指定许可证，在 README 写明 License pending，不要擅自决定；复制参考代码时单独遵守其许可证。

若当前目录不是 Git 仓库：初始化 Git，将分支命名为 main，并把 origin 设置为 https://github.com/hqching77/Course-Replay.git。提交信息使用英文 Conventional Commits。

执行 push 前检查远程、分支、待提交文件和秘密。没有 GitHub 认证时不得声称推送成功，应完成本地提交并给出准确 push 命令。未经明确授权不得强推或覆盖远程历史。

### 14. 代码质量

- 模块职责单一，不把所有后端逻辑堆在一个 server.py。
- AI、embedding、OCR、存储均使用接口抽象。
- API 错误结构统一，HTTP 状态码正确。
- 前端组件包含 loading、empty、error、retry 状态。
- 不提交缓存、虚拟环境、数据库、上传材料或真实密钥。
- 代码和文档应允许另一位开发者在新机器按 README 独立启动。

### 15. 完成回复格式

完成后按以下格式回复：

1. 已完成：真实实现并验证的功能。
2. 架构：前端、后端、数据库、检索、AI Provider 的关键选择。
3. 验证结果：实际执行的测试、构建和 Docker 命令及结果。
4. 启动方式：从克隆到运行的准确命令。
5. Git 状态：分支、最近提交、远程和是否推送。
6. 剩余工作：真实未完成的 P1 项或阻塞。
7. 安全检查：确认没有 API Key 或用户材料进入 Git。

现在开始：先检查当前仓库和参考项目，给出简短计划，然后实现 Course Replay MVP。

---

## 推荐分阶段使用

若一次开发时间有限，将 P0 分三次交付：

1. Milestone 1：工程骨架与材料库——课程 CRUD、上传、解析、任务进度、数据库、基础前端、测试和 Docker。
2. Milestone 2：AI 检索与课堂重放——Provider、embedding、RAG 引用、知识路径、课堂重放、自由追问。
3. Milestone 3：学习闭环——互动问题、掌握度、探索分支、题单、Cheatsheet、学习记录。

每个里程碑都必须独立可运行并提交到 Git，后一个阶段在前一个通过测试后再开始。
