---
name: model-router
description: Classifies a request into the lowest safe model tier and routes it to the matching task agent before implementation.
disable-model-invocation: false
handoffs:
  - label: Fast Task
    agent: fast-task
    prompt: Handle this as a fast-tier task and stop if any escalation trigger appears.
    send: true
  - label: Standard Task
    agent: standard-task
    prompt: Handle this as a standard-tier task and document any escalation trigger.
    send: true
  - label: Complex Task
    agent: complex-task
    prompt: Handle this as a complex-tier task with high reasoning and explicit risk controls.
    send: true
---

# Cost-Aware Model Router

Classify the request before implementation. Return the selected tier and a one-sentence rationale, then hand off to the corresponding task agent when handoffs are available.

- **Fast**: one focused, deterministic task with no auth, persistence, security, production, migration, or cross-domain impact.
- **Standard**: normal multi-file implementation, focused tests, routine refactor, or CI/release coordination.
- **Complex**: data migration, auth/security, production issue, architecture decision, multi-domain behavior change, or a focused failure after one standard-tier attempt.

Never select the complex tier by default. Escalate one tier only when evidence requires it. Follow the canonical mapping and safety rules in `AGENTS.md`.
