# Roadmap: homework help, exam revision and weak-point memory

Status: **Phase 1 done** (2026-11-03): 导入课本 / 批量导入, weak-point record, 考前冲刺, teacher's emphasis, past papers. Phase 2: **题目答疑 done** (2026-11-03, see "题目答疑 as built"); 错题本 / 今日复习 not started. See "Phase 1 as built" below.

## The problems

1. **Homework (题目答疑).** Teacher-assigned homework is hard to do alone, and asking a general AI gives answers without teaching. Nothing gets concluded or remembered.
2. **Exam revision (考前冲刺).** With a midterm a week away there is too much to revise, and revision time goes to things already known instead of weak points and unknowns.

Both are solved by the same core: **the app has to know what you don't know.**

---

## Core: weak-point record (per course)

Every feature below writes to and reads from one record per course.

| Field | Meaning |
| --- | --- |
| Knowledge point | Links to a node in the course's notes (课堂重放), or a free-text topic if the notes don't cover it |
| Mistake type | 概念不清 / 不会起步 / 计算错误 / 粗心 |
| Evidence | The problems, self-test answers or class questions that showed it |
| Status | 薄弱 → 好转 → 已掌握 (cleared only after **two later correct answers** on that point) |

Sources that feed it:
- homework checks and guided sessions (题目答疑) — Phase 2
- 自测题 answers in 课堂重放, marked by the grader
- 考前冲刺: wrong diagnosis answers and 我不会这个, and targeted practice

Class questions (课上提问) and knowledge points never opened in 课堂重放 are **priority signals in the revision plan, not weak-point entries**: asking a question isn't a mistake, and an unopened note isn't evidence of not knowing it.

The user can see the list, edit it, and remove entries.

---

## Feature 1: 题目答疑 (homework help)

Input: the question and the user's answer, as a photo (handwritten), PDF or typed text. The vision model reads photos. Formulas are rendered as LaTeX. Each problem belongs to a course and is linked to knowledge points in its notes.

### Mode A: check my answer (批改)
- Verdict: 正确 / 部分正确 / 错误.
- If not correct:
  - the first step where it goes wrong;
  - why it's wrong;
  - the correct final answer.
- **No full solution by default.** Buttons: 看完整步骤 · 给我提示 · 我再改一次.

### Mode B: guide me to start (引导)
- For "I don't know where to begin". Hints come one level at a time:
  1. which concept or theorem applies;
  2. how to set up the first step;
  3. the next step after the user tries.
- Each attempt is checked; the AI nudges and never dumps the solution unless asked.

### Ending every problem
- A short conclusion card: the key idea, the method to reuse, and what the user got stuck on.
- That is written into the weak-point record, linked to the matching note (e.g. "复习 第 3 讲 · 时移性质").

---

## Feature 2: 考前冲刺 (exam revision mode)

1. **Setup:** exam date, which lectures/sections are in scope, time available per day.
2. **Quick diagnosis:** 2–3 questions per knowledge point, generated from the notes. Each topic is sorted into 已掌握 / 不稳 / 不会. Topics already mastered are skipped.
3. **Day-by-day plan up to the exam**, ordered by:
   - how weak the topic is (diagnosis + weak-point record);
   - how likely it is to be tested (teacher's emphasis, past papers);
   - prerequisite order (前置 before 核心 before 进阶).

   Each block is concrete, e.g. "35 min: 虚函数与多态 — reread the note, then 3 targeted problems."
4. **Targeted practice:** problems only on weak points. Results update the weak-point record and the plan reshuffles.

Requires notes for every lecture in scope; lectures without notes need slides uploaded and built first.

---

## Other features

1. **What the teacher stressed.** Find moments in class transcripts where the teacher says "这个要考", "这里很重要", "考试会出" etc. Mark them in the notes and give them more weight in revision.
2. **Past papers.** Upload old midterms/finals. Map each question to a topic to show which topics come up repeatedly, and practise in the same style.
3. **错题本 with spaced review.** Every wrong answer goes in automatically. A daily 10-minute "今日复习" on the dashboard re-asks items after 1, 3 and 7 days.
4. **同类题.** After a homework mistake is fixed, generate a similar problem to confirm it's really understood.
5. **One-page formula sheet** for the exam scope, with not-yet-mastered topics highlighted.
6. **Deadlines and exams per course** on the dashboard, with countdowns (uses the semester week). The revision plan reads these dates.
7. **3-question quiz right after class** (下课小测), to lock in the lecture while it's fresh.

---

## Feature 3: 导入课本 / 批量导入 (textbook and bulk import)

Two kinds of material: one textbook as a single PDF (600+ pages, LaTeX), or a teacher's files split per section (1.1, 1.2 … 4.2). Both should end up grouped by chapter. **No AI for the splitting**: everything uses PyMuPDF, which the backend already has, so 600 pages take seconds.

### Detecting the structure

Many files (1.1, 1.2 …):
- Read the number from the file name: `1.1`, `1-1`, `1_1`, `§1.1`, `Ch1.1`, `LA_4.2`, `第1章第1节`, `第一章` (Chinese numerals converted).
- Sort numerically (1.2 before 1.10) and group by chapter.
- Chapter title from the first file's first large-font heading; otherwise "第 N 章".
- If a file name has no number, read it from the first heading on page 1 (e.g. "4.2 Eigenvalues").

One big textbook, tried in this order:
1. **PDF bookmarks.** LaTeX with `hyperref` embeds the whole table of contents (level, title, start page). Instant.
2. **Printed contents pages.** Parse lines like `4.2 Eigenvalues ........ 213` from the 目录/Contents pages and map printed page numbers to PDF pages using page labels, or by finding the page where the title appears.
3. **Large headings.** Find lines in a much bigger font than the body matching `Chapter 4` / `第4章` / `4.2 Title`.
4. If all fail (scanned books): the user marks page ranges.

Filters applied to the proposal:
- 前言, 目录, Preface, Index, References, 参考文献 are excluded by default.
- If bookmarks have a "Part I" level above chapters, use the level that holds the chapters.
- "只导入到第 N 章" for an exam scope.

### Flow: nothing is split until the user approves

1. **Upload → analyse (read-only).** Files go to a temporary area and the server returns a proposed structure. Nothing is split and no 小节 is created.
2. **Review page, after filtering:**
   - each chapter with its title, page range (e.g. p. 15–62 · 48 页) or its files, ticked or unticked;
   - excluded items stay visible, greyed, with the reason (e.g. "前言 · 自动排除"), so they can be ticked back;
   - where the structure came from (e.g. "来自 PDF 书签");
   - the first and last page of each chapter as thumbnails, to check every cut visually;
   - controls: move a boundary ±1 page, edit titles, merge with the previous/next chapter, split at a page;
   - changing the filter (e.g. 只导入到第 4 章) updates the proposal without uploading again;
   - a summary, e.g. "将创建 4 个小节，共 212 页；排除 前言、目录、索引".
3. **确认拆分 → only now:** chapters are cut into separate PDFs by page range (fast, no re-rendering) and each becomes a 小节 marked 待构建. **Cancel** deletes the temporary files and creates nothing.
4. **Notes are built only on request,** per chapter or several in a queue, because AI over 600 pages at once is slow and costly. A 50-page chapter takes about 3 batches with the existing batch reading.

The chapter structure also gives 考前冲刺 its scope ("期中范围：第 1–4 章") and topic order.

### Testing
- Generated PDFs with bookmarks, without bookmarks (contents page only), and with headings only.
- Messy file names.
- Real linear algebra files.
- A 600-page document for speed.

### Decisions (2026-11-03)
- **Bulk import is always by chapter:** 1.1, 1.2 and 1.3 go into one 小节 "第 1 章", the same for the chapters of a single textbook PDF. There is no per-section option.
- **No separate textbook group.** Normal use is unchanged: create a course, add 小节 and upload files yourself. Bulk import simply adds one 小节 per chapter to the course.
- **Two entry points:** "批量导入" on a course page (adds chapters to that course), and an option when creating a course to import a textbook or a folder of files, so the new course starts organised by chapter.

---

## Phase 1 as built

- **Weak points** (`course.weakPoints`, synced and encrypted with the course): one entry per knowledge point (or per section when a question can't be matched to a point). Wrong or partly correct answers add evidence and reset the streak; two correct answers in a row → 已掌握. Shown on the course page under 薄弱点 with 读笔记, 练习, mark mastered and delete.
- **Marking** (`POST /api/practice/grade`): verdict, mistake type, what went wrong, the correct answer; full steps only behind 看完整步骤. Used by 自测题 in 课堂重放 and by targeted practice.
- **考前冲刺** (`/courses/:id/exam`, `course.exam`):
  - setup: name, date, minutes per day, sections in scope (only sections with notes);
  - diagnosis: 2 multiple-choice questions per point (`/api/practice/quiz`), with 我不会这个 / 我很熟，跳过 to decide a point at once; both right = 已掌握, one = 不太稳, none = 不会;
  - plan: 不会 first, then 不太稳 (and undiagnosed points with strong signals), then the rest; within a band, points that are weak points, stressed in class or in past papers come first, then lecture order. Topics fill each day up to the time available, the day before the exam is for review, and what doesn't fit is listed separately. Two correct practice answers mark a point mastered and it drops out of the plan;
  - targeted practice (`/api/practice/problems`): 3 problems from the note, previous mistakes and past-paper questions, each marked.
- **Teacher's emphasis:** no AI. Transcript lines matching 要考 / 重点 / 很重要 / 记住 / 易错 … are matched to knowledge points by shared words (the line itself counts double against its neighbours). Shown as ★ in the transcript note and 老师强调过 in the plan.
- **Past papers** (`/api/practice/past-paper`): the vision model copies each question and maps it to a knowledge point; counts appear as 往年考过 N 次 and practice follows those questions.
- **Import:** as specified above (`/api/import/analyze`, `/thumb`, `/apply`, `DELETE`).

All AI output uses the `@@TAG` text format rather than JSON, so LaTeX can't break parsing.

### 知识档案 (one record across all courses)

- **What's recorded:** every marked answer is counted per knowledge point (`section.study.answers`: right / wrong / last result), together with 我会了 / 我还不会. Nothing else is new; the record is computed from these counts, weak points, the exam check and what was read in 课堂重放.
- **Levels:** 已掌握 / 答对过 / 不太稳 / 薄弱 / 学过、未测. The newest information wins: what you said, then weak points, then the exam check, then answer counts.
- **Who reads it:** a short text version is sent with every AI request that teaches or sets problems: AI 讲师, the in-class assistant, targeted practice and note generation (`learner_memory`). It's only used inside the prompt and isn't stored on the server. The current course is described in detail, every other course briefly, plus points from other courses that look related to what's on screen.
- **Finding the same idea in another course:** no AI. Two titles share a meaningful term (e.g. 矩阵 in 《程序设计》二维数组与矩阵运算 and 《线性代数》矩阵乘法), with generic words like 概念 / 应用 ignored. The AI gets the related points and decides whether they really connect.
- **Where you see it:**
  - the `/knowledge` page (知识档案): every point in every course, cross-course links, 我会了 / 我还不会, and the exact text the AI reads;
  - 其他课程里学过 under a note in 课堂重放;
  - links in the exam diagnosis and plan.
- **New exam plans start from the record:** mastered points are skipped and weak points start as 不会.

## 题目答疑 as built

- **Where:** 题目答疑 in the sidebar (opens the last course used) and on each course page (`/courses/:id/homework`).
- **Question and answer are separate**, so the question can go in on a PC and the answer later from a phone or tablet:
  - each problem is saved on its own (`homework_items` table, `/api/homework`), not inside the course, so two devices never overwrite each other's work;
  - a `version` number turns a stale save into "已载入最新内容" instead of data loss;
  - the PC re-reads the list every few seconds while the page is open, so an answer photographed on a phone shows up by itself;
  - "用手机 / 平板交答案" shows a QR code for the problem's URL. The phone needs to be signed in to the same account.
- **Input:**
  - you can type (LaTeX works, with a 预览公式 tab) or use 拍照 / 上传图片、PDF;
  - photos are shrunk on the device first, which also turns iPhone HEIC into JPEG;
  - `/api/homework/read` copies the question, or the student's working line by line, into text once. The copy keeps the student's mistakes, and every later turn is text only.
- **批改** (`/check`): 正确 / 部分正确 / 错误, the mistake type, the **first** wrong step, why it's wrong, and the correct final answer. Full steps are worked out but only shown on 看完整步骤. After that come 给我提示, 再交一次 and 结束这道题.
- **带我起步** (`/guide`):
  - one hint at a time: first which concept, then how to write the first step, then the next step based on the student's latest attempt;
  - each attempt is checked (这一步对了 / 这一步有问题);
  - the answer is never given unless 看完整解答 is pressed.
- **结束这道题** (`/conclude`):
  - the summary card has the key idea, the method to reuse, and where the student got stuck;
  - 自己做出来了 only counts if the solution wasn't viewed;
  - the result goes through the same `recordAnswer` as everything else (source 作业), so it shows in 薄弱点, 知识档案 and the exam plan, linked to the knowledge point the AI picked from the course's list.
- **One input box:** type, take a photo, upload a file, paste a screenshot (Ctrl/⌘+V) or drag a file in. Pictures are copied into the text so the student can check them.
- **Switching modes:** a 批改 / 提示引导 switch above the input, available at any point in a problem.
- **问一问** (`/ask`): the student sends an idea or a question. The AI judges the idea (想法对 / 部分对 / 想法有问题) or answers the question, without giving the full solution unless that message asks for it.
- **Context for the AI:** the two best-matching notes from the course, the course's knowledge-point list, and the 知识档案. The correct answer from marking is kept out of the hint history so hints can't give it away.

## Order

| Phase | When | What |
| --- | --- | --- |
| 1 | Done | 导入课本 / 批量导入 (so all exam material is in) · weak-point record · minimal 考前冲刺 (diagnosis, daily plan, targeted practice) · teacher's emphasis from transcripts · past-paper upload |
| 2 | 题目答疑 done; 错题本 next | 题目答疑 (check + guide) writing into the weak-point record · 错题本 with 今日复习 |
| 3 | Later | 同类题 · formula sheet · deadlines/exam dates · 下课小测 |

