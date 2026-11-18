---
name: acceptance-validation
description: Prove a built app works: derive a test plan from SPEC.md scenarios, run logic, API, UI and security tests, then smoke-test on the user's real machine and report pass/fail with evidence. Use after building or changing an app, before saying it is done.
---

# Acceptance validation

Nothing is done until it has run where the user will use it. Sandbox tests are necessary, not sufficient.

## Steps

1. **Test plan.** List every scenario ID from SPEC.md and map it to a check. Mark each as automated, real-environment, or user-only (sign-in, payment, a physical device).
2. **Automated layers.**
   - Logic: pure functions with realistic seeded data (including edge cases and bad input).
   - API: every route, with and without credentials, wrong host, wrong origin, bad parameters, oversized input.
   - Agent loops: a fake model that returns scripted tool calls, so approval gates, error handling and prompt-injection stances are tested without real spend.
   - UI: Playwright screenshots at wide and narrow widths, light and dark, with data and empty; check console errors; check keyboard focus; look at the screenshots yourself and fix what looks wrong.
   - Security: tokens, host checks, path traversal, escaping of untrusted text, no secrets in logs or output.
3. **Deploy to the real machine.** Copy the build, restart the app, and confirm the running version string matches the build. A mismatch means the old copy is still running: say so and have the user restart it.
4. **Real-environment smoke test.** Using the browser or computer-use tools available, walk the top scenarios in the real app: first screen, one read, one write, one failure path, one approval flow. Capture screenshots as evidence. Never enter the user's passwords or payment details; ask them to.
5. **Report.** A short matrix: scenario ID, pass, fail or blocked, and the evidence. For blocked items say exactly what the user has to do. List known gaps honestly.
6. **Regression.** After every fix or change request, re-run the full automated suite and the smoke test before saying it is done.

## Rules

- Do not mark a scenario passed from reasoning alone; run it.
- Fix failures and re-run; do not hand failures to the user to discover.
- Keep the test files with the project so future changes can re-run them.
- State plainly what was not verified on the real machine.
