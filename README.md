# Adaptive Testing Platform

A domain-agnostic adaptive learning platform that fuses SM-2, FSRS, and IRT scheduling algorithms with AI-powered analytics and operational KPI gating.

## Tech stack

- **React 19** with TypeScript and JSX
- **Vite 7** — dev server and bundler
- **Tailwind CSS** — utility-first styling
- **Vitest** — test runner (jsdom environment, `@testing-library/react`)
- **D3 v7** and **Recharts** — data visualization
- **Three.js** / **@react-three/fiber** — 3D knowledge graph
- **Framer Motion** — animations
- **Groq SDK** — AI analytics

## Getting started

```sh
npm install
npm run dev
```

The dev server starts at http://localhost:3000.

## Key scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server on port 3000 |
| `npm run build` | Production build via Vite |
| `npm test` | Run the full Vitest suite (95 tests across 19 files) |
| `npm run test:conformance` | Run algorithm conformance + smoke tests only |
| `npm run kpi:run` | Evaluate KPI gates and write a report to `analysis/` |
| `npm run rollout:check` | Run staged rollout decision logic (24-hour cooldown) |

## Architecture overview

The platform does three jobs:

1. **Study** — SM-2 and FSRS schedulers queue cards at the right time based on measured stability and difficulty.
2. **Test** — An IRT-based adaptive engine estimates learner ability and terminates sessions as soon as the ability estimate stabilizes, requiring fewer questions than fixed-length tests.
3. **Understand** — A Groq-powered analytics layer explains performance in plain language and exposes the underlying scheduler curves through components like `FSRSAnalysisCharts`, `ForgettingCurveAnalysis`, and `IRTPredictions`.

**Diagnostic components** surface leech cards (`LeechDetection`), spacing compliance (`SpacingEffectAnalysis`, `SpacedRepetitionCompliance`), inter-card interference (`InterferenceAnalysis`), memory strength (`MemoryStrengthAnalysis`), and session optimization (`SessionOptimization`).

**Operational tooling** (`scripts/kpi/run-kpi.ts`, `scripts/rollout/run-rollout-check.ts`) evaluates a fixed set of KPI gates defined in `src/lib/kpiGates.ts` — Overall Accuracy >= 75%, Retention >= 70%, Average Response <= 6000ms, Fatigue Drop <= 15%, Retrieval Strength >= 60%, Processing Speed >= 55% — and persists auditable JSON reports to `analysis/`. The rollout script requires explicit gate flags to PROMOTE (`--conformance-pass true --latency-pass true --kpi-regression false`); omitting any flag produces HOLD with unverified-gate reasons rather than a spurious promotion.

**Algorithm conformance** is verified by `src/lib/__tests__/algoConformance.test.ts`, which covers IRT, SM-2, FSRS, Ebbinghaus, KPI gates, and rollout policy. The same vectors drive the in-app `AlgorithmValidation` component.

**School edition features** are designed for single-user use today and multi-user server deployment tomorrow. The **Class Leaderboard** (Goals → Achievements tab) shows a ranked class of demo students with per-student subject tags, class aggregate stats, and a server-mode callout explaining how real classmates will replace demo data on deployment. The **Biometric Integration** panel (AI Settings) provides per-signal enable/disable toggles, a live wellbeing preview demo with simulated readings, and a teacher-dashboard privacy note scoped to school data-protection norms.

**TypeScript status:** `npx tsc --noEmit` reports 0 errors. The full type debt (502 → 0) was resolved across cycles 2–16B and is recorded in `gap-register.md` as gap #13 (complete). Every file in the project is tsc-clean.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
