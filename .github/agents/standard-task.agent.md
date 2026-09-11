---
name: standard-task
description: Handles normal implementation work including bug fixes, focused multi-file changes, and routine refactors.
user-invocable: false
disable-model-invocation: false
agents: []
---

# Standard Task Agent

Handle the implementation scope assigned by the coordinator with a focused plan. Keep the change reviewable and return testing, release, or project-metadata needs to the coordinator for direct specialist routing.

Escalate to the complex tier only for a data migration, auth/security concern, production incident, architecture decision, multi-domain behavior change, or after one evidence-backed standard-tier failure. Follow `AGENTS.md` for the canonical routing and repository rules.
