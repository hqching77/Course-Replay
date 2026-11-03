# Notes for coding agents

Course Replay: a study app for university courses. Live class transcription, notes generated from slides, replay with an AI tutor, 题目答疑, 考前冲刺, 知识档案.
Frontend: React + Vite (`src/`). Backend: FastAPI + SQLAlchemy (`backend/`, managed with uv).

## Cautions (read first)

### 1. Don't put the prompt I give in the UI.

What I tell you is a request to you. It isn't copy for the people who use the app.

- **My own wording:** don't paste my requirements or explanations onto the page.
  - Real example: I asked for chapter splitting "without AI, because the textbook is 600 pages". The loading screen then said 「不用 AI，600 页的课本也只要几秒」. A student reading that would find it strange: they never asked about AI or page counts.
- **My examples:** don't reuse them as placeholders or hints. Avoid things like 「线性代数.pdf」, 「1.1 … 4.2」, my school or my exam. Use neutral, general wording.
- **My rules restated as promises:** don't echo them as UI text. Examples: 「这条提示只出现一次」, 「不会直接给答案」, 「完整步骤要你点了才给」. Build the behaviour; don't announce it.
- **Implementation details:** keep them off the page. That includes no-OCR, which model or prompt is used, matching by shared words, localStorage, "the server doesn't store this", and how many questions count as mastered.
- **What UI text should do:** say what the user can do or what is happening now, in a few words. If a sentence only makes sense to someone who read our chat, delete it.

Before finishing a UI change, read every new string as a student who has never seen our conversation.

### 2. No secrets or dev setup in the repo or the UI

- Never commit `.env` files, API keys, tokens or real passwords. Only commit `*.example` files with placeholders.
- No development hints in the interface. Examples: "set OPENAI_API_KEY in .env", localhost URLs, debug panels.

### 3. Tell me when I need to install something

When you add a dependency, say so in your reply with the exact command, because my machine won't have it.
- Frontend: `npm install`, then restart `npm run dev`.
- Backend: `cd backend && uv sync`.

A missing package shows up as e.g. `Failed to resolve import "qrcode"`.

### 4. Every UI string goes through `t()`

- Chinese is the source text. Add the English to `src/i18n-en.ts`.
- Server error messages that the UI shows go in the `INDIRECT` list in `scripts/check-i18n.mjs`.
- Run `node scripts/check-i18n.mjs`; it must report 0 missing, 0 unused and 0 unwrapped.
- AI prompt text written in the frontend stays Chinese and is marked `// i18n-ok: AI prompt text`.

## Run

```bash
npm install && npm run dev              # frontend :8000, proxies /api → :8001
cd backend && uv sync --extra test
uv run uvicorn app.main:app --reload --port 8001
```

Testing on a phone: run `npm run dev -- --host` and open the PC's LAN address. Phones can't open `localhost`.

## Checks before committing

```bash
npx tsc -b && npx tsc --noEmit --noUnusedLocals -p tsconfig.json
node scripts/check-i18n.mjs
npm run build
cd backend && uv run python -m pytest -q          # SQLite
TEST_DATABASE_URL=postgresql+psycopg://… uv run python -m pytest -q   # Postgres too, when the DB layer changes
```

## How things fit together

- **Workspace sync (`src/workspace.ts`):**
  - courses and sections are saved to the server for signed-in users, and to localStorage offline;
  - a changed section is sent whole, and a changed course sends all its course-level fields;
  - data that two devices may edit at the same time must not live in the course record. 题目答疑 has its own table (`homework_items`) with a version number.
- **Encryption at rest:** user content columns use `EncryptedText` / `EncryptedJSON`. New columns on existing tables go in `ADDED_COLUMNS` in `backend/app/database.py`.
- **AI output format:** structured AI output uses the `@@TAG` text format (`parse_blocks` in `backend/app/api/practice.py`), not JSON, because LaTeX backslashes break JSON.
- **Answers and the knowledge record:**
  - every marked answer goes through `recordAnswer` (`src/exam.ts`), which updates weak points, per-point answer counts and the exam plan together;
  - `知识档案` (`src/memory.ts`) is computed from those records;
  - a text version is sent with AI requests as `learner_memory`.
- **Docs:** see `docs/ROADMAP.md` for what's built and what's next, and `DEPLOY.md` for hosting.

## Working with me

- Be direct and concise. Results first, no filler.
- Show changes in the browser (Playwright is available) rather than assuming they work.
- Commit messages end with the attribution lines I ask for.
