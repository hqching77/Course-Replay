# Course Replay：17:00 前三人并行构建逻辑

当前基线分支：Aiopr

时间窗口：2026-10-18 13:15–17:00（Asia/Shanghai）

目标不是在今天完成完整产品，而是在 17:00 前交付一条可现场演示、可继续扩展的真实主链路：

创建课程 → 上传 PDF/PPTX/MD/TXT → 解析文本 → AI 生成知识点 → 课堂重放 → 回答一道题 → 更新掌握度 → 生成复习总结。

## 一、今天必须保住的范围

### 必须真实工作

- 单用户、单机运行。
- 课程创建和课程列表。
- 上传 PDF、PPTX、MD、TXT。
- 提取文件文本和来源页码/幻灯片号。
- 显示处理状态：上传中、解析中、已完成、失败。
- 调用用户提供的 OpenAI-compatible API。
- 根据课程材料生成 5–10 个有顺序的知识点。
- 课堂重放页显示知识点主线、当前讲解、来源引用和互动问题。
- 用户提交答案后得到评价，并更新本地掌握度。
- 生成 Markdown 格式的复习题单或 Cheatsheet。
- 刷新页面后课程、材料、知识点和掌握度仍存在。

### 今天主动砍掉

- 图片 OCR、DOCX、知识图谱力导向动画。
- 向量数据库和复杂混合 RAG；今天使用课程内文本块关键词匹配加上下文截取。
- 多用户登录、权限、云存储、Celery。
- SSE 流式输出、PDF 导出、跨课程检索。
- 多模型设置页面；只通过后端 .env 配置一个 Provider。

如果核心流程在 15:30 前已打通，再逐项恢复 DOCX、embedding 检索或图片 OCR。

## 二、最小架构

采用单仓库：

    backend/
      app/
        main.py
        config.py
        database.py
        models.py
        schemas.py
        api/
          courses.py
          documents.py
          replay.py
        services/
          parser.py
          chunker.py
          ai_provider.py
          course_ai.py
          mastery.py
      tests/
      requirements.txt
    frontend/
      src/
        api/
        components/
        pages/
        types/
      package.json
    data/                 # gitignored
    docs/
    .env.example
    .gitignore
    docker-compose.yml

后端：FastAPI + SQLAlchemy + SQLite。

前端：React + TypeScript + Vite。若脚手架安装受阻，可退化为 React CDN 静态前端，但三人必须在 13:30 前统一决定，不能中途更换。

AI：OpenAI Python SDK，使用 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_CHAT_MODEL。

检索：将材料切为约 1,500–2,500 字符的 chunks；根据当前知识点标题做简单关键词评分，取前 4 个 chunk 作为上下文。该实现必须封装在 retrieval 函数中，后续可替换为 embedding。

## 三、三人分工

### A：后端与集成负责人

目录所有权：backend/app、backend/tests、根目录环境配置。

任务：

1. 初始化 FastAPI、SQLite、SQLAlchemy 和 CORS。
2. 实现 Course、Document、Chunk、KnowledgeNode、ReplaySession、MasteryRecord。
3. 实现课程 CRUD 和文件上传接口。
4. 实现 PDF、PPTX、MD、TXT 解析与 chunk。
5. 实现 AI Provider 和知识点/讲解/出题/评价/复习总结接口。
6. 维护 API 契约并负责 16:00 后集成修复。

完成定义：curl 或 Swagger 可独立走完整后端链路。

### B：课堂重放前端负责人

目录所有权：frontend/src/pages、frontend/src/components、frontend/src/styles。

任务：

1. 建立课程仪表盘和新建课程表单。
2. 建立课程详情页、材料上传区和处理状态。
3. 建立三栏课堂重放页：知识点主线、当前材料/引用、AI 讲解与答题。
4. 建立复习总结弹窗或页面。
5. 所有页面先接 mock 数据，14:30 后只根据固定 API 契约替换数据源。

完成定义：无后端时可使用 mock 演示完整点击流程；接后端后可展示真实数据。

### C：前端数据层、测试与交付负责人

目录所有权：frontend/src/api、frontend/src/types、frontend 配置、README、Docker、CI。

任务：

1. 初始化 Vite/TypeScript、路由和 API client。
2. 根据本文件的 API 契约定义 TypeScript 类型。
3. 封装课程、上传、知识点、replay、答题和总结请求。
4. 添加前端错误、loading、空状态和本地 session 恢复。
5. 补充 README、.env.example、.gitignore、启动脚本和最小测试。
6. 15:30 后协助接口联调和演示数据准备。

完成定义：新环境按 README 可以启动，前端 build 通过，API 错误可见。

## 四、固定 API 契约

三人以此为准。需要变更时由 A 在群内通知，不允许各自猜字段。

### 健康检查

    GET /api/health
    response: { "status": "ok", "ai_configured": true }

### 课程

    GET /api/courses
    response: [{
      "id": "uuid",
      "name": "数字电路",
      "description": "...",
      "document_count": 2,
      "knowledge_count": 8,
      "mastery": 0.35,
      "created_at": "ISO-8601"
    }]

    POST /api/courses
    body: { "name": "数字电路", "description": "..." }
    response: Course

    GET /api/courses/{course_id}
    response: CourseDetail

### 上传材料

    POST /api/courses/{course_id}/documents
    content-type: multipart/form-data
    field: files
    response: {
      "documents": [{
        "id": "uuid",
        "filename": "lesson1.pdf",
        "status": "processing"
      }]
    }

    GET /api/courses/{course_id}/documents
    response: [{
      "id": "uuid",
      "filename": "lesson1.pdf",
      "file_type": "pdf",
      "status": "processing|ready|failed",
      "progress": 80,
      "error": null
    }]

### 构建知识点

    POST /api/courses/{course_id}/knowledge/build
    response: { "status": "ready", "count": 8 }

    GET /api/courses/{course_id}/knowledge
    response: [{
      "id": "uuid",
      "title": "组合逻辑电路",
      "definition": "...",
      "learning_order": 1,
      "mastery": 0.2,
      "citations": [{
        "document_id": "uuid",
        "filename": "lesson1.pdf",
        "page": 3,
        "slide": null,
        "chunk_id": "uuid"
      }]
    }]

### 课堂重放

    POST /api/courses/{course_id}/replay/start
    response: ReplayState

    GET /api/replay/{session_id}
    response: ReplayState

ReplayState：

    {
      "session_id": "uuid",
      "course_id": "uuid",
      "current_index": 0,
      "total": 8,
      "node": KnowledgeNode,
      "explanation": "AI 讲解",
      "question": {
        "id": "uuid",
        "type": "short_answer",
        "prompt": "请解释……"
      },
      "citations": []
    }

    POST /api/replay/{session_id}/next
    response: ReplayState

    POST /api/replay/{session_id}/ask
    body: { "question": "为什么？" }
    response: { "answer": "...", "citations": [] }

    POST /api/replay/{session_id}/questions/{question_id}/submit
    body: { "answer": "用户答案" }
    response: {
      "score": 0.8,
      "verdict": "understood|partial|guessed|gap",
      "feedback": "...",
      "reference_answer": "...",
      "mastery_before": 0.2,
      "mastery_after": 0.35,
      "citations": []
    }

### 复习总结

    POST /api/courses/{course_id}/artifacts/cheatsheet
    response: {
      "id": "uuid",
      "title": "数字电路 Cheatsheet",
      "content_markdown": "# ..."
    }

## 五、时间表与闸门

### 13:15–13:30：统一契约

- 三人阅读本文件。
- A 创建后端骨架；C 创建前端骨架；B 画出并开始实现三个核心页面。
- 确认 Node、Python、包管理器和 API Key 是否可用。
- 13:30 后不再更改技术栈。

### 13:30–14:30：各自完成可独立运行模块

- A：课程 CRUD、上传、解析、数据库。
- B：mock 驱动的完整前端主流程。
- C：API client、类型、路由、README 骨架。

14:30 闸门：

- 后端 Swagger 能创建课程并上传一个 PDF。
- 前端能用 mock 完成从课程页进入课堂重放。
- 若任何一项失败，立即停止高级功能，只修主链路。

### 14:30–15:30：AI 和首次联调

- A：知识点生成、课堂讲解、题目与评价。
- B/C：接入真实课程、上传和知识点接口。
- 使用一份 5–15 页的小型 PDF 作为固定演示材料。

15:30 闸门：

- 浏览器中能创建课程、上传材料并看到知识点。
- 若 AI 不可用，保留清晰错误，并准备由真实解析文本生成的降级知识点；不得伪造 AI 已调用成功。

### 15:30–16:15：闭环与冻结

- 接通 replay、答题、掌握度和 Cheatsheet。
- 16:00 起不再增加新功能。
- 16:15 代码冻结，只修阻断演示的问题。

### 16:15–16:45：集成测试

- 清空本地 data 后按 README 从头启动。
- 执行完整人工验收一次。
- 测试刷新恢复、API 错误和空状态。
- 检查 Git 中无 .env、数据库、上传文件和 API Key。

### 16:45–17:00：演示准备

- 固定演示文件和演示顺序。
- 提交最终代码，记录 commit hash。
- 保留本地已解析演示课程，但不得提交用户材料。
- 准备 2–3 分钟讲解：痛点、上传、课堂重放、答题反馈、复习总结。

## 六、Git 协作规则

Aiopr 是集成基线。不要三个人同时直接修改相同文件。

推荐分支：

    Aiopr-backend
    Aiopr-replay-ui
    Aiopr-integration

都从最新 Aiopr 创建。每 30–45 分钟做一个小提交并推送自己的分支。16:00 前由 A 或指定集成人员合并回 Aiopr。

目录所有权能避免大部分冲突：A 不改 frontend；B 不改 API client 和根配置；C 不改 B 的页面组件，除非双方明确同步。

合并顺序：后端骨架 → 前端骨架/API client → 页面 → 联调修复 → 文档与 CI。

不要在截止日前做大规模重构、改目录名或统一格式化整个仓库。

## 七、最小演示脚本

1. 打开首页，创建“数字电路”课程。
2. 上传固定 PDF 或 PPTX，展示真实处理状态。
3. 点击“生成课程路径”，出现有顺序的知识点。
4. 点击“开始课堂重放”，展示当前知识点讲解和来源引用。
5. 回答一道题，展示 AI 反馈与掌握度变化。
6. 点击下一知识点，再进行一次自由追问。
7. 生成 Cheatsheet，展示 Markdown 总结。
8. 刷新页面，证明课程和进度仍存在。

## 八、后续构建顺序

17:00 演示版完成后再依次升级：

1. embedding + BM25 混合检索。
2. 图片 OCR 和 DOCX。
3. 知识图谱、前置知识补全和探索分支持久化。
4. 错题变体、复习题单配置和学习记录分析。
5. SSE、PDF 导出、认证和正式部署。
