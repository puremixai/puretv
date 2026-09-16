# OpenTV Lint Warning Baseline Cleanup Implementation Plan

> 2026-09-15 复审：此清理提交的部分 effect 改动存在运行时回归；后续纠偏与验证见 [运行时纠偏记录](../../lint-runtime-corrections.md)。以下为原实施记录，不应作为运行时无回归的结论。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the remaining 699 OpenTV lint warnings by warning type while preserving behavior and keeping the existing `.eslint-baseline.json` as the comparison baseline.

**Architecture:** Work through one ESLint rule family at a time, beginning with mechanical unused-variable cleanup and ending with React Compiler diagnostics that require component-level reasoning. Each family gets a fresh lint checkpoint; only warnings removed or reduced are acceptable, and new warnings must be fixed before moving on.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.8, ESLint 9 flat config, Jest 30, pnpm.

**Spec:** Current `pnpm lint` output and the user's request to process all unhandled warnings by type in sequence.

## Global Constraints

- Do not update or regenerate `D:\bbs\OpenTV\.eslint-baseline.json`.
- Preserve runtime behavior; do not replace intentional server-only CommonJS or dynamic theme CSS without checking its loading semantics.
- Use UTF-8 files and keep formatting changes limited to touched code.
- After each task run `pnpm lint`; after the final task run `pnpm exec jest --runInBand tests/lint-baseline.test.js` and `pnpm typecheck`.

---

### Task 1: Remove or rename unused variables

**Files:**
- Modify: files reported by `unused-imports/no-unused-vars` (141 warnings)
- Test: `tests/lint-baseline.test.js`

**Approach:** Inspect each reported binding. Remove genuinely dead local bindings and unused catch bindings, preserve initializers with side effects, and prefix intentionally-unused parameters or variables with `_` so the existing rule configuration documents the intent.

- [x] **Step 1:** Generate the complete `unused-imports/no-unused-vars` location list and inspect each surrounding declaration.
- [x] **Step 2:** Apply only declaration-level changes; do not change control flow or API payloads.
- [x] **Step 3:** Run `pnpm lint` and confirm this rule decreases without any other rule increasing.
- [x] **Step 4:** Run `pnpm exec jest --runInBand tests/lint-baseline.test.js`.

### Task 2: Replace explicit `any` where the type is locally knowable

**Files:**
- Modify: files reported by `@typescript-eslint/no-explicit-any` (174 warnings)
- Test: affected TypeScript files through `pnpm typecheck`

**Approach:** Replace `any` with existing project types, `unknown` plus narrowing, or narrowly-scoped interfaces. Keep third-party/vendor boundary casts isolated when a complete type is not available, and do not silence the rule globally.

- [x] **Step 1:** Group the warnings by API boundary, player/media data, and generic utility code.
- [x] **Step 2:** Convert one group at a time, adding narrowing at the point of use.
- [x] **Step 3:** Run `pnpm typecheck` and `pnpm lint`; stop if a conversion changes runtime-facing shapes.

### Task 3: Resolve Next.js image and navigation recommendations

**Files:**
- Modify: files reported by `@next/next/no-img-element` (58 warnings)
- Modify: files reported by `@next/next/no-location-assign-relative-destination` (12 warnings)
- Modify: `src/app/layout.tsx` only if the dynamic theme stylesheet has an equivalent supported loading path

**Approach:** Convert images to `next/image` only where dimensions, remote-host configuration, and object-fit behavior are known. Replace internal client navigation with `useRouter().push` only in event handlers where a full reload is not required. Preserve auth redirects and external URLs that intentionally use `window.location`.

- [x] **Step 1:** Inventory each image source and navigation target before editing.
- [x] **Step 2:** Apply conversions in small route/component groups and verify affected JSX types.
- [x] **Step 3:** Run `pnpm lint` and `pnpm typecheck` after the group.

### Task 4: Clean remaining small ESLint rules

**Files:**
- Modify: files reported by `@typescript-eslint/no-require-imports` (6 warnings)
- Modify: `src/app/layout.tsx` for `@next/next/no-css-tags` (1 warning) only if behavior is preserved

**Approach:** Convert the three TV remote route imports only after confirming static import preserves the server adapter singleton. Leave the vendored CommonJS `src/lib/pancheck/vendor/http.js` in its upstream format unless an equivalent module conversion is proven safe. Treat the dynamic `/api/theme/css` stylesheet as an intentional framework exception if it cannot be statically imported.

- [x] **Step 1:** Inspect module format and runtime-loading assumptions for each warning.
- [x] **Step 2:** Apply only proven-safe import changes; retain intentional exceptions with a precise rule-level suppression if needed.
- [x] **Step 3:** Run `pnpm lint` and `pnpm typecheck`.

### Task 5: Resolve React Hook and Compiler diagnostics

**Files:**
- Modify: files reported by `react-hooks/exhaustive-deps` (41 warnings)
- Modify: files reported by `react-hooks/set-state-in-effect` (202 warnings)
- Modify: files reported by `react-hooks/immutability` (45 warnings)
- Modify: files reported by `react-hooks/purity` (11 warnings)
- Modify: files reported by `react-hooks/refs` (6 warnings)
- Modify: files reported by `react-hooks/preserve-manual-memoization` (2 warnings)

**Approach:** Handle dependency correctness first, then effect state transitions, immutable render data, render purity, ref access, and manual memoization. Use existing component patterns and preserve asynchronous loading, playback, and cleanup behavior; do not silence compiler rules just to reduce the count.

- [x] **Step 1:** Fix one component pattern at a time, starting with exhaustive dependency warnings that have stable callback dependencies.
- [x] **Step 2:** Refactor effect-driven state updates into event handlers, derived state, or asynchronous callbacks only where the data flow supports it.
- [x] **Step 3:** Move render-time mutations, impure calls, and ref reads to initialization, effects, or event handlers without changing user-visible timing.
- [x] **Step 4:** Align or remove manual memoization only after checking recalculation and dependency semantics.
- [x] **Step 5:** Run `pnpm lint`, `pnpm typecheck`, and the lint-baseline Jest test after each component group.

### Task 6: Final verification

**Files:**
- Verify: `D:\bbs\OpenTV\.eslint-baseline.json` remains unchanged
- Verify: all modified source files

- [x] **Step 1:** Run `pnpm lint` and record the final warning count and rule breakdown.
- [x] **Step 2:** Run `pnpm exec jest --runInBand tests/lint-baseline.test.js`.
- [x] **Step 3:** Run `pnpm typecheck`.
- [x] **Step 4:** Run `git diff --check` and verify no baseline file change.
