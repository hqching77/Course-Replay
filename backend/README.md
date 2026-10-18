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

## 启动

在仓库根目录运行：

    cd backend
    $env:UV_CACHE_DIR='.uv-cache'
    uv sync --extra test --python C:\Python314\python.exe
    uv run uvicorn app.main:app --reload --port 8001

Swagger UI 地址为 http://127.0.0.1:8001/docs 。

启用 AI 前，在仓库根目录 `.env` 填写 `OPENAI_API_KEY` 和 `OPENAI_CHAT_MODEL`。默认 Base URL 为 `https://cdn.cheaprouter.cc/v1`。

PPTX、DOCX 的完整视觉输入在 Windows 上可使用已安装的 Microsoft Office，其他环境使用 LibreOffice。两者都不存在时接口会返回明确错误，不会退化为只读取文字。

## 测试

    cd backend
    .\.venv\Scripts\python.exe -m pytest -q

测试不会调用真实付费 AI API。
