# MedAssist-ng - Copilot Entry Point

This file is intentionally thin. `AGENTS.md` is the canonical governance file for this repository.

If rules differ between files, follow `AGENTS.md`.

## Required Startup Steps

1. Read `AGENTS.md` first when it exists in the workspace.
2. Ensure `doku/memory_notes.md` and `doku/report.md` exist and keep them updated during meaningful work. These files are local-only and must not be staged or committed unless explicitly requested.
3. Identify triggered skills from `AGENTS.md` and read only the matching `SKILL.md` files before making changes.
4. Follow delegation boundaries from `AGENTS.md`: `@testing-manager` for testing work and `@release-manager` for release orchestration, including the documented fallback protocol when a required specialist is unavailable.
5. Keep all non-canonical instruction files brief and aligned with `AGENTS.md`; do not duplicate full governance here.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
