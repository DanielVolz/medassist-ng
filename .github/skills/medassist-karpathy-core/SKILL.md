---
name: medassist-karpathy-core
description: Apply assumption clarity, simplicity-first implementation, surgical diffs, and goal-driven verification for non-trivial coding tasks.
---

# Skill Instructions

Use this skill as an execution style layer for implementation tasks where overengineering, broad refactors, or unclear assumptions are likely.

## Use When

- The request is ambiguous and assumptions must be made explicit.
- The change can easily balloon in scope.
- A bug fix or feature needs explicit success criteria and verification.
- You need to keep diffs minimal and directly tied to the request.

## Do Not Use When

- The task is trivial and can be completed safely without extra process overhead.
- The task is only about ownership routing (use `medassist-testing-handoff` / `medassist-release-handoff`).
- The task is only about domain guardrails already covered by specialized skills (architecture, DB, i18n, UI, security, config, observability).

## Core Principles

### 1. Think Before Coding

- Do not assume silently.
- State assumptions explicitly.
- If multiple interpretations exist, present them instead of picking one invisibly.
- If uncertain or blocked by ambiguity, stop and ask.
- If a simpler approach exists, call it out.

### 2. Simplicity First

- Implement the minimum code required to solve the asked problem.
- Do not add speculative features, abstractions, or configurability.
- Avoid defensive handling for impossible scenarios.
- If the solution feels overcomplicated, simplify before finalizing.

### 3. Surgical Changes

- Touch only lines required for the request.
- Do not refactor unrelated areas.
- Match existing local style and patterns.
- Remove only unused code introduced by your own change.
- If unrelated dead code is discovered, mention it but do not remove it unless requested.

### 4. Goal-Driven Execution

- Translate requests into verifiable outcomes before implementation.
- For multi-step tasks, define short steps with checks.
- Verify the requested behavior explicitly before declaring done.

Example execution frame:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

## Response Format

When this skill is used, report briefly:

- Assumptions made (or clarifications requested)
- Why the chosen approach is the simplest viable one
- What was changed (and what was intentionally not changed)
- Verification performed and result
