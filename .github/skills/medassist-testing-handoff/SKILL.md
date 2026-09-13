---
name: medassist-testing-handoff
description: Route broad MedAssist requests for test planning, test changes, local execution, or test CI failures to testing-manager, including equivalent German requests.
---

# Testing Handoff

## Use When

Use only for a broad initial request involving test planning, writing or changing
tests, local test execution, or failures in `test.yml` or `e2e.yml`.

## Do Not Use When

Do not use for an already-specific test-design, local-validation, or CI-triage
request; load that phase skill directly. Do not use for PR, release, or non-test
workflow work.

## Ownership And Handoff

- `@testing-manager` owns test planning, test changes, local execution, and test
  CI triage; `@release-manager` owns PR/release and non-test workflow work.
- Provide scope, expected behavior, affected files, available failure evidence, and
  requested outcome.
- The manager selects exactly one relevant phase skill before work begins.
