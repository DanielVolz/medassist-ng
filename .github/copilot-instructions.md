# MedAssist Copilot Instructions

This is the portable fallback. When AGENTS.md exists, it is canonical.

## Startup

1. Read AGENTS.md when available.
2. Read only the relevant current sections of root MEMORY.md; keep that file under 80 lines and replace stale entries instead of appending history.
3. Inspect git status before editing and preserve unrelated changes.
4. Load only skills triggered by the current scope.

## Routing

Use engineering-orchestrator as the default entry point. Route implementation through model-router to the lowest capable tier. Route specialist work directly: testing to testing-manager, release work to release-manager, and metadata-only GitHub work to project-bot. engineering-reviewer provides independent engineering review for material risk. Keep one implementation owner and one writer per file set, limit normal fan-out to three independent read-only workers, and allow at most one focused repair pass.

Keep the portable safety baseline: use English for repository artifacts, call frontend APIs through /api/*, preserve SQLite compatibility, validate and surface errors, and never perform remote release operations outside release-manager.
