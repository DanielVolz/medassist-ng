# AGENTS.md

Canonical local governance for coding agents in this repository. If repo instruction files disagree, follow this file.

## Startup Routine

1. Read the project orientation below.
2. Read `MEMORY.md` current state and any relevant durable lessons before meaningful work.
3. Inspect the requested scope and current worktree state before editing.
4. Load only the matching skills from the routing table.
5. Keep changes scoped to the user's current objective and existing repository patterns.

## Local Memory

- Use root `MEMORY.md` as the only local persistence file for agent continuity.
- Create `MEMORY.md` at the repository root if missing before meaningful work.
- Use it for durable project context only: architecture notes, real conventions, recurring pitfalls, decisions, validation state, and open risks that future agents need.
- Keep it short, stable, and concrete; avoid transcripts, daily chatter, speculative notes, stale detail, and secrets.
- Append or revise concise notes after meaningful work so the current state stays useful.
- Do not create or maintain `doku/report.md` unless the user explicitly asks for a separate local report.
- `MEMORY.md` is local-only state. It must stay ignored and must not be staged, committed, or sent upstream unless the user explicitly requests that exact action.
- This replaces the previous conversation-persistence rule tied to `doku/APP_BEHAVIOR.md`.

## Project Orientation

- Product: MedAssist-ng is a medication planning app with stock tracking, reminders, refill history, sharing, and optional auth/SSO.
- Shared package: TypeScript contracts and helpers in `shared/`; build it before backend or frontend commands that depend on it.
- Frontend: React + TypeScript + Vite in `frontend/`.
- Backend: Fastify + TypeScript + Drizzle + SQLite in `backend/`.
- Frontend browser code calls `/api/*`; Vite proxies to backend routes under `backend/src/routes/`.
- Main DB tables live in `backend/src/db/schema.ts`: `users`, `medications`, `user_settings`, `dose_tracking`, `refill_history`, `share_tokens`.

Core backend areas:

- Auth/session/SSO: `backend/src/routes/auth.ts`, `backend/src/routes/oidc.ts`, `backend/src/plugins/auth.ts`.
- Medication CRUD: `backend/src/routes/medications.ts`.
- Notifications/reminders: `backend/src/services/reminder-scheduler.ts`, `backend/src/routes/planner.ts`, `backend/src/routes/settings.ts`.
- Export/import/sharing: `backend/src/routes/export.ts`, `backend/src/routes/share.ts`.

Core frontend areas:

- Pages: `frontend/src/pages/`.
- Shared orchestration: `frontend/src/context/AppContext.tsx`.
- Domain hooks: `frontend/src/hooks/`.
- Localization: `frontend/src/i18n/en.json`, `frontend/src/i18n/de.json`.

## Hard Rules

- English only for code, comments, docs, and commit messages.
- Keep `AGENTS.md` as the single source of truth. Other instruction files should be short entry points that defer here.
- Do not automatically commit after implementation. Leave changes visible unless the user explicitly asks for a commit.
- When the user starts an unrelated task while the normal workspace has local changes, ask whether to commit/review those changes before starting.
- Do not default to a separate worktree just because the workspace is dirty. Use one only when asked, when parallel work must remain available, when current changes are unsafe to move, or when switching branches would mix unrelated work.
- Pure governance/documentation edits do not require branch switching unless they would be bundled into a product PR.

## Prohibited Remote Operations

Normal agents must never run commands that publish or modify remote repository state:

- `git push`, `git push -f`, or any `git push <remote> <branch>`.
- `gh pr create`, `gh pr merge`, `gh pr close`.
- `gh release create`, `gh release edit`.
- `git tag`, `git tag -a`.
- Any equivalent command that sends commits, branches, tags, releases, or PR metadata to a remote.

For explicit push, PR, merge, tag, or release requests, the normal agent's required action is to hand off to `@release-manager`. Do not treat quoting or summarizing these instructions as completion. Do not push even if the user says "push it".

## Scope And Branching

- One PR per logical change: one feature, one bug fix, one refactor, or one docs update.
- Do not mix product changes with unrelated test-infra, config, or refactor churn.
- Target review size: <= 500 changed lines.
- Hard stop: split work above about 800 changed lines or more than 3 top-level domains (`backend`, `frontend`, `docs`, `doku`, `.github`).
- If scope drift appears, stop adding to the current branch, keep only required changes, and move unrelated work to follow-up branches/PRs.
- Use broad thematic branches/worktrees for materially different work areas, for example `intake`, `refill`, `notifications`, `auth`, `sharing`.
- Reuse a theme branch for follow-ups in the same area instead of making one branch per micro-change.
- If isolation is impractical because the workspace is already heavily dirty, keep edits tightly scoped and record why in `MEMORY.md`.

## Engineering Rules

- Security by default: never commit secrets; validate and sanitize external input; enforce auth/authz server-side.
- Fail fast and clearly; never swallow errors without actionable context.
- CI is a hard gate: no merge/release flow with failing required checks.
- Preserve API/DB contracts; avoid silent breaking changes.
- Keep health checks and structured operational logging intact.
- Keep lockfiles consistent; remove unused dependencies; prefer minimal maintained packages.
- Update docs when behavior, setup, config, operations, or user workflows change.
- Prefer explicit readable code. No nested ternaries. Favor early returns over deep nesting.
- Delete obsolete code when replacing a feature or fix path.
- Always clean up dead code from older or failed approaches before handoff. Do not leave unused fallback paths, duplicate logic, stale listeners, unreachable branches, commented-out implementations, or tests for behavior that is no longer part of the final fix.
- Reuse existing UI patterns and components such as `ConfirmModal`, `MedicationAvatar`, and the existing style system.

## CI Triage

- Do not open a local browser, Chrome, or a browser automation session to inspect GitHub Actions, pull-request checks, workflow failures, logs, or artifacts.
- Use `gh` or the GitHub API/MCP for CI triage, including check status, failed-job logs, artifacts, reruns, and PR metadata.
- Open a browser only when validating a rendered product UI state that cannot be established from code, tests, or CI logs. A GitHub Actions URL is not a product UI validation target.

## Authenticated UI Verification

When fixing or reviewing UI that lives behind login or depends on authenticated app state:

- Open the real in-app screen in a logged-in browser session before editing.
- Verify the actual rendered state; do not stop at the login page or infer from code alone.
- If credentials or session access are unavailable, ask the user for the required login context instead of making blind UI changes.

## App Boundaries

| Concern | Allowed locations | Do not place changes in |
|---|---|---|
| Shared contracts and helpers | `shared/**` | Duplicated backend/frontend definitions |
| HTTP routes and request validation | `backend/src/routes/**` | `frontend/**`, service modules as route entrypoints |
| Business logic and scheduling | `backend/src/services/**` | React components, page files, bloated route handlers |
| Persistence schema and migrations | `backend/src/db/schema.ts`, `backend/src/db/client.ts`, `backend/drizzle/**` | Frontend models, destructive DB rewrites |
| Auth/session/OIDC server concerns | `backend/src/plugins/auth.ts`, `backend/src/routes/auth.ts`, `backend/src/routes/oidc.ts` | Frontend-only guards |
| Frontend pages and UI flows | `frontend/src/pages/**`, `frontend/src/components/**` | Backend presentation code |
| Frontend orchestration and hooks | `frontend/src/context/**`, `frontend/src/hooks/**` | Backend services/routes |
| Localization strings | `frontend/src/i18n/en.json`, `frontend/src/i18n/de.json` | Hardcoded user-facing TS/TSX copy |
| E2E tests | `frontend/e2e/**` | Product runtime code |
| Unit tests | `backend/src/test/**`, `frontend/src/test/**` | Production modules |

## Project Guardrails

- DB changes must be backward-compatible for existing SQLite files:
  1. Add columns in `backend/src/db/schema.ts` with defaults.
  2. Add alter migrations in `backend/src/db/client.ts` `runAlterMigrations()`.
  3. Read new fields null-safe with `?? defaultValue`.
- Never remove or rename existing DB columns.
- Drizzle migrations must use descriptive names: `NNNN_<what_changes>.sql`.
- Keep `backend/drizzle/meta/_journal.json` tags aligned with migration filenames, without `.sql`.
- If renaming a migration, keep its `idx` and `when` unchanged.
- New API fields belong end-to-end: route DTO/parsing, domain behavior if needed, DB compatibility path, frontend usage through `/api/*`.
- Notification changes must update both `backend/src/services/reminder-scheduler.ts` and `backend/src/routes/planner.ts`.
- Medication edit UI changes must update both `MedicationsPage.tsx` and `MobileEditModal`.

## No-Touch Zones

Do not hand-edit, stage, commit, or treat these as product changes unless the user explicitly requests that exact artifact:

- Generated reports/output: `frontend/playwright-report/**`, `frontend/test-results/**`, `frontend/coverage/**`, `backend/coverage/**`.
- Local Spec Kit state: `.specify/**`, `specs/**`, `docs/SPEC_KIT.md`, `.github/agents/medassist-feature-orchestrator.agent.md`, `.github/agents/speckit.*.agent.md`, `.github/prompts/speckit.*.prompt.md`.
- Runtime/local data: `data/**`.
- Build outputs and local runtime folders.

## Mandatory Parity Rules

- Desktop + mobile edit parity: medication edit has two paths, `MedicationsPage.tsx` and `MobileEditModal`; update both for form fields, sections, or UI elements.
- Notification dual paths: reminders flow through scheduler and manual/planner paths; update both for notification format, text, styling, or logic.

## Skills

Before each task, infer applicable skills from intent and touched paths, then read only the matching `SKILL.md` files. Do not preload unrelated skills.

| Trigger | Skills to load |
|---|---|
| Backend route/auth/input changes | `Architecture Guard`, `Security Sanity` |
| DB/schema/persisted data changes | `DB Compatibility` plus `Architecture Guard` if API/DTO touched |
| Frontend UI/text changes | `UI Consistency`, `i18n Enforcer` |
| Visual polish only | `UI Consistency`, then `Frontend Polish` |
| Notification behavior/scheduler/startup/error paths | `Observability Guard` plus `Security Sanity` if external input/auth involved |
| Env/Docker/proxy/runtime config | `Config Change Guard` |
| Behavior/setup/workflow docs | `Doc Sync Guard` |
| Broad test planning, test writing, test execution, or CI test failure request | `Testing Handoff` |
| Test planning, test writing, or changing tests | `Test Design` |
| Local test, lint, type-check, or build execution | `Test Local Validation` |
| Failures in `test.yml` or `e2e.yml` | `Test CI Triage` |
| Push, PR, merge, tag, or release requests | `Release Handoff` |
| SemVer decision or release branch/PR preparation | `Release Preflight` |
| Existing PR CI monitoring or merge readiness | `Release CI Monitoring` |
| GitHub release-note drafting, review, or editing | `Release Notes` |
| Merged release tag, publishing, or post-release assets | `Release Publish` |
| Changes under `.github/skills/**` | `Skill Quality Review` |
| Ambiguous or scope-sensitive non-trivial implementation tasks | `Karpathy Core` |

Skill files:

| Skill | File |
|---|---|
| Architecture Guard | `.github/skills/medassist-architecture-guard/SKILL.md` |
| DB Compatibility | `.github/skills/medassist-db-compat-check/SKILL.md` |
| i18n Enforcer | `.github/skills/medassist-i18n-enforcer/SKILL.md` |
| UI Consistency | `.github/skills/medassist-ui-consistency/SKILL.md` |
| Frontend Polish | `.github/skills/medassist-frontend-polish/SKILL.md` |
| Security Sanity | `.github/skills/medassist-security-sanity/SKILL.md` |
| Observability Guard | `.github/skills/medassist-observability-guard/SKILL.md` |
| Config Change Guard | `.github/skills/medassist-config-change-guard/SKILL.md` |
| Doc Sync Guard | `.github/skills/medassist-doc-sync-guard/SKILL.md` |
| Testing Handoff | `.github/skills/medassist-testing-handoff/SKILL.md` |
| Test Design | `.github/skills/medassist-test-design/SKILL.md` |
| Test Local Validation | `.github/skills/medassist-test-local-validation/SKILL.md` |
| Test CI Triage | `.github/skills/medassist-test-ci-triage/SKILL.md` |
| Release Handoff | `.github/skills/medassist-release-handoff/SKILL.md` |
| Release Preflight | `.github/skills/medassist-release-preflight/SKILL.md` |
| Release CI Monitoring | `.github/skills/medassist-release-ci-monitoring/SKILL.md` |
| Release Notes | `.github/skills/medassist-release-notes/SKILL.md` |
| Release Publish | `.github/skills/medassist-release-publish/SKILL.md` |
| Skill Quality Review | `.github/skills/medassist-skill-quality-review/SKILL.md` |
| Karpathy Core | `.github/skills/medassist-karpathy-core/SKILL.md` |

## Delegation

- `@engineering-orchestrator` is the single default user entry point for every task. It classifies implementation complexity, routes specialist ownership directly, and coordinates without routinely implementing.
- Testing ownership is `@testing-manager`: test planning, writing, execution, and CI test triage (`test.yml`, `e2e.yml`).
- Release ownership is `@release-manager`: PR/release orchestration, merge flow, and workflow monitoring.
- Independent review ownership is `@engineering-reviewer`: correctness, security, architecture, compatibility, and missing-test review without file edits.
- Normal agents must not delegate release work to arbitrary subagents. Route push, PR, merge, tag, and release requests specifically to `@release-manager`.
- If a required specialist is unavailable, hangs, or returns no useful status, continue locally only as far as needed to unblock the explicit request.
- Fallback protocol: keep scope focused, document why fallback was used in `MEMORY.md`, report exact commands/results, and do not perform prohibited release actions.
- CI failure triage and final release orchestration still return to the owner when available.

## Agent Operating Model

- Enter through `@engineering-orchestrator`; it routes trivial work to `fast-task` with minimal ceremony and adds coordination only when specialization, isolation, parallel read-only analysis, or an independent gate is justified.
- Route once at task start. Do not route a specialist through a generic worker: testing goes directly to `@testing-manager`, release directly to `@release-manager`, and project metadata directly to `@project-bot`.
- Keep one implementation owner and one writer per file set. Parallelize only independent read-only work or writes in explicitly isolated worktrees.
- Limit normal fan-out to three workers. Nested delegation is off by default; enable it only for bounded divide-and-conquer work with an explicit depth and stopping condition.
- Every handoff must include: objective, owned scope, relevant evidence, constraints, expected output, validation, and escalation trigger. Return findings and evidence, not raw logs or broad transcripts.
- Before multi-step work, create and reuse one compact current context: objective, controlling files/symbols, validated facts, pending decision, and falsifying check. Refresh only facts changed by code, external state, or a specific unresolved dependency; do not reload stable instructions or broad context. This does not replace mandatory current `MEMORY.md` and status reads.
- Use bounded phases for multi-domain infrastructure or operations work: Diagnose (read-only evidence and hypothesis), Repair (one owner and scoped implementation), Validate/Release (focused verification and authorized handoff). Start each phase with only its evidence, scope, acceptance check, and stop condition. Keep test ownership with `@testing-manager` and final release execution with `@release-manager`; its state machine owns continuous release monitoring.
- Use a producer-reviewer loop only for material risk. Allow one focused repair pass after review; unresolved or newly expanded risk returns to the coordinator or user instead of looping.
- Stop when acceptance criteria and required gates pass. Do not spend tokens polishing unaffected code, repeating successful checks, or consulting extra agents without a decision they can change.
- Treat instructions as guidance, not enforcement. Keep tool permissions least-privilege, use sandboxing where available, and retain CI, branch protection, and human review as final controls.

## Cost-Aware Model Orchestration

This routing policy applies to Codex and GitHub Copilot. Classify the task before choosing a model, agent, or delegation path. Start with the lowest capable tier and escalate only when concrete evidence requires it.

For implementation work, classify the change through `model-router` before delegating to `fast-task`, `standard-task`, or `complex-task`. Route testing, release, and project-metadata work directly to their specialists without a generic tier hop. Read-only discovery and small governance edits may use the fast tier directly when no specialist action is required.

| Tier | Model | Use for | Required agent role |
|---|---|---|---|
| Fast | `GPT-5.6 Luna` (lowest cost/capability) | Targeted questions, read-only lookups, one-file copy or documentation edits, formatting, and deterministic commands | `fast-task` |
| Standard | `GPT-5.6 Terra` (medium cost/capability) | Normal bug fixes, small multi-file changes, and routine refactors | `standard-task` |
| Complex | `GPT-5.6 Sol` (highest cost/capability) | Data migrations, auth/security, production incidents, multi-domain behavior changes, architecture decisions, difficult root-cause analysis, or a scoped failure after one standard-tier attempt | `complex-task` |

- Do not choose the complex tier merely because a task is broad, unfamiliar, or inconvenient. Split independent work first and keep each slice at the lowest viable tier.
- Escalate exactly one tier when the current tier cannot establish a safe path, a focused check fails, or new evidence expands the scope. Record the evidence in the handoff; do not silently retry on an expensive model.
- Managed Copilot agent frontmatter must use the model mapped to its role above; change the mapping and `scripts/validate-agent-harness.mjs` together. Model selection never relaxes security, testing, approval, or release rules.
- PR creation, upstream push, release coordination, and workflow monitoring bypass generic task tiers and run directly through `@release-manager`.

## GitHub Project And Traceability

- Ensure a related issue exists and is labeled (`enhancement`, `bug`, `triage`) when GitHub/project tooling is available.
- Move project items to In progress when project tooling is available.
- If GitHub/project tooling is unavailable, continue local implementation and note the missing handoff in the final summary.
- When a PR closes an issue, keep `Closes #N` in the PR body and add an issue comment linking the PR and summarizing the fix.
- Release notes use short commit hashes, not PR numbers.

## Delivery Workflow

1. Confirm acceptance criteria, worktree safety, and the lowest capable route.
2. Load only triggered skills and gather the minimum evidence needed to identify the controlling path and a falsifying check.
3. Assign one implementation owner; use parallel read-only discovery only when it reduces uncertainty or elapsed time.
4. For material-risk changes, obtain an independent `@engineering-reviewer` pass and repair only actionable findings.
5. Hand off test planning/execution to `@testing-manager`, or use the documented fallback protocol.
6. Hand off PR/merge/release work to `@release-manager`; use `@project-bot` for metadata-only coordination.
7. Record concise evidence: changed scope, checks and results, residual risk, and the next owner. After merge, verify issue/PR traceability.

## Local Commands

```bash
npm run lint
npm run lint:fix
npm run check
npm run build
```

## Instruction Layout

- `AGENTS.md`: canonical local governance, skill routing, and ownership.
- `.github/copilot-instructions.md`: committed entry point for Copilot/cloud agents; it should stay short and defer to `AGENTS.md` when present.
- `.github/skills/*/SKILL.md`: detailed skill rules, read only when triggered.
- `.github/agents/*.agent.md`: thin Copilot coordinators, workers, and specialists; ignored Spec Kit definitions are local generated integrations.
- `.codex/agents/*.toml`: local Codex custom-agent definitions; these are intentionally local-only.
