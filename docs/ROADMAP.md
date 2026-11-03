# Roadmap: homework help, exam revision and weak-point memory

Status: planned, not started. Agreed in discussion on 2026-11-03.

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
- homework checks and guided sessions (题目答疑)
- 自测题 answers in 课堂重放 (already graded by the AI tutor)
- 课上提问: each question asked in class marks a moment of not understanding
- knowledge points never opened in 课堂重放

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

## Order

| Phase | When | What |
| --- | --- | --- |
| 1 | Now (midterm next week) | Weak-point record · minimal 考前冲刺 (diagnosis, daily plan, targeted practice) · teacher's emphasis from transcripts · past-paper upload |
| 2 | Next | 题目答疑 (check + guide) writing into the weak-point record · 错题本 with 今日复习 |
| 3 | Later | 同类题 · formula sheet · deadlines/exam dates · 下课小测 |

## Open questions before starting

- Which course is the midterm for, and does it have notes for every lecture in scope?
- Are past midterm papers available?
- Will homework usually arrive as photos of handwritten work, PDFs, or typed text?
