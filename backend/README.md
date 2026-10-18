# Course Replay Backend

FastAPI、SQLAlchemy 与 SQLite 构成的 Course Replay MVP 后端。

## 当前已实现

- 健康检查与 AI 配置状态。
- 课程创建、列表、读取和删除。
- PDF、PPTX、Markdown、TXT 上传。
- 后台文本提取和 chunk 建立。
- 文档状态、任务状态和抽取内容接口。
- 知识点、课堂重放、掌握度和学习产物的数据模型。
- 可供下一阶段使用的 OpenAI-compatible Provider 边界。

## 启动

在仓库根目录运行：

    cd backend
    $env:UV_CACHE_DIR='.uv-cache'
    uv sync --extra test --python C:\Python314\python.exe
    uv run uvicorn app.main:app --reload --port 8000

Swagger UI 地址为 http://127.0.0.1:8000/docs 。

启用 AI 前，把仓库根目录的 .env.example 复制为 .env 并填写配置。

## 测试

    cd backend
    .\.venv\Scripts\python.exe -m pytest -q

测试不会调用真实付费 AI API。
