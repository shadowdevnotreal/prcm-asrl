# Adaptive Testing Platform

## The flashcard app that actually knows how you learn.

---

## The one-line pitch

A domain-agnostic adaptive learning platform that fuses three research-grade scheduling algorithms — SM-2, FSRS, and IRT — with AI-powered analytics and operational KPI gating, turning any subject into a measurably faster path to mastery.

---

## The problem

Traditional flashcard tools treat every learner, and every card, the same. Anki-style SM-2 is powerful but rigid. Modern learners need software that adapts to *them*: what they know, what they're about to forget, and what's actually worth their next ten minutes. Educators and trainers have no visibility into *why* a learner is struggling — they get raw scores, not insight.

---

## The solution

One app does three jobs:

1. **Study** — SM-2 and FSRS schedulers queue the right card at the right time.
2. **Test** — An IRT-based adaptive engine estimates true ability from fewer questions.
3. **Understand** — A Groq-powered analytics layer explains performance in plain language and predicts where the learner is headed next.

---

## What's inside

**Three schedulers, one queue.**
SM-2 for the classic Anki workflow, FSRS for the modern stability/difficulty model, and IRT for ability-calibrated testing. The actual forgetting curves the schedulers fit are visible in-app — the math is transparent, not hidden.

**Adaptive testing that stops early.**
The IRT engine estimates learner ability and item parameters, then terminates sessions as soon as the ability estimate stabilises. Ability trajectories and per-item correctness probabilities are plotted in real time.

**AI analytics in plain language.**
Full Groq configuration: API key management, model selection, and diagnostics toggle. Designed export paths for TensorFlow, PyTorch, HuggingFace, and OpenAI fine-tuning. AI-assisted card QA, coaching, and session summaries.

**School-grade biometric monitoring.**
Per-signal enable/disable toggles for heart rate, eye tracking, stress, focus, and fatigue. A live wellbeing preview with simulated readings and adaptive-application status indicators. Teacher-dashboard privacy model: only anonymised class aggregates are surfaced — no raw biometric data exposed. Marked School Edition.

**Class leaderboard, not a global one.**
The Achievements tab hosts a school-themed class leaderboard: ranked students with subject tags, class aggregate stats (average accuracy, top streak, total cards reviewed), and medal indicators for the top three. A server-mode callout explains how real student data replaces demo entries on deployment. Designed for a clean upgrade to server-side multi-student data with no frontend changes required.

**Diagnostic depth.**
The platform doesn't just track accuracy — it explains the shape of a learner's problem:

- Leech Detection — cards that keep failing
- Spacing Effect and Compliance Analysis — whether study intervals are actually spaced
- Interference Analysis — similar cards degrading each other
- Memory Strength and Learning Efficiency — separating effort from retention
- Study-Test Comparison and Session Optimisation — where study time pays off
- Forgetting Curve Analysis — Ebbinghaus retention curves per card and deck

**Visualisation that earns its pixels.**
A 3D knowledge graph and a complementary 2D force-directed view make topic structure legible. Predictive forecasts stay inline with the cards they describe.

**Gamification without the slot-machine.**
The RPG module is optional and layered over the scheduler — not a replacement for it.

**Operational tooling.**
`npm run kpi:run` evaluates six required KPI gates: accuracy ≥ 75%, retention ≥ 70%, average response ≤ 6000 ms, fatigue drop ≤ 15%, retrieval strength ≥ 60%, processing speed ≥ 55%. `npm run rollout:check` turns those results into staged rollout decisions — internal → 5% → 25% → 50% → 100% — with 24-hour cooldown windows. Every run writes a versioned report to `analysis/`, so decisions are auditable.

**Verifiable algorithms.**
An in-app conformance suite covers IRT, SM-2, FSRS, Ebbinghaus, KPI gates, and rollout policy. The same vectors drive the automated test suite. Run `npm test` and see for yourself.

**Portable and private — school-ready and server-ready.**
Single-user mode runs entirely in the browser with no backend. Server mode adds real multi-student leaderboards, teacher wellbeing dashboards, shared decks, and class-level analytics — behind the same interface the single-user already knows.

---

## Why it wins

Most competitors pick one algorithm and build a UI around it. This platform built an engine around three, then wrapped it in the diagnostics that explain *which* algorithm is helping *which* learner on *which* card. KPI gates carry per-gate regression budgets so releases don't silently erode the metrics users actually feel. Conformance tests and persisted rollout artifacts mean the platform's claims are reproducible, not marketing. Evidence over vibes.

---

## Use cases

1. **Medical education** — board prep with ability-calibrated question selection
2. **Law school** — bar prep with interference detection across overlapping doctrines
3. **Corporate compliance** — measurable retention, not just seat-time
4. **Language learning** — FSRS-tuned intervals plus leech detection for stuck vocabulary
5. **K-12 and higher education** — class leaderboard, biometric wellbeing monitoring, teacher dashboard, school-edition server deployment
6. **Professional certification** — CAT-style shorter, fairer assessments
7. **Internal onboarding** — track what new hires actually retain by week four
8. **Self-study for hard exams** — actuarial, CFA, engineering boards
9. **Research** — a reproducible, instrumented platform for learning-science studies

---

## Who it's for

Learners who want to stop guessing what to review. Educators who need to see *why* a student is stuck. Training leaders who need evidence their programme works. Researchers who need an instrumented platform they can actually inspect.

---

## Call to action

Clone it, run `npm run kpi:run`, and check the generated report in `analysis/`. The algorithms, the gates, and the rollout logic are all in the repo. Read the code, run the tests, then decide.
