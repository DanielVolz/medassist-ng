# MedAssist-ng - Copilot Entry Point

This file is intentionally thin. The committed repository governance file is `.github/copilot-governance.md`.

If a local-only `AGENTS.md` exists in the current workspace, treat it as a local overlay for that checkout. The committed baseline for upstream/cloud sessions is `.github/copilot-governance.md`.

## Required Startup Steps

1. Read `.github/copilot-governance.md` first.
2. If `AGENTS.md` exists locally in the workspace, apply it as an additional local overlay.
3. Ensure `doku/memory_notes.md` and `doku/report.md` exist and keep them updated during meaningful work. These files are local-only and must not be staged or committed unless explicitly requested.
4. Identify triggered skills from the committed governance and local overlay, then read only the matching `SKILL.md` files before making changes.
5. Follow the repository delegation boundaries for testing and release work, including the documented fallback protocol when a required specialist is unavailable.
6. Keep non-canonical instruction files brief and aligned with `.github/copilot-governance.md`.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
