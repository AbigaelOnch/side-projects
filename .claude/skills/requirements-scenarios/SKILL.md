---
name: requirements-scenarios
description: Interview the user and write SPEC.md for a new app or feature, thinking through scenarios, constraints and UI decisions up front. Use before building anything non-trivial, or when asked to define requirements.
---

# Requirements and scenarios

Goal: a spec the user approves, detailed enough that building and testing need almost no further questions.

## How to run the interview

1. Start from the intake brief. Research anything you do not know (a service's API, terms, platform support) before asking, so the questions are informed.
2. Ask in 2 or 3 rounds, each a batch of at most 4 multiple-choice questions (use AskUserQuestion), recommended option first. Do not ask what you can decide sensibly or look up. Round 1: purpose, users, platform, accounts and data sources. Round 2: constraints and choices that came out of your research. Round 3: look and feel and what should be automatic versus manual.
3. Draft SPEC.md, summarise it in a few lines, and ask for approval or changes. Do not paste the whole document into chat.

## SPEC.md template

- **Purpose and users**: one paragraph, who and why.
- **Environment**: OS, browser, window sizes, light and dark, offline behaviour, where data lives.
- **Feasibility and constraints**: for every integration, what is officially possible, what is not, the terms of service, cost, and who signs in. Say plainly what will not be built and why.
- **Capabilities**: numbered, each one sentence.
- **Safety and approval rules**: what needs the user's approval, what is read-only, what leaves the machine (and to whom), what is stored.
- **Look and feel**: references, theme default, density, navigation model, copy tone. Lock this early; design changes late are the most expensive.
- **Scenario matrix**: IDs (S-001...) with Given/When/Then. Cover each of these on purpose:
  - first run with nothing set up; empty states; very large data
  - happy path for each capability; doing it twice; undoing it
  - bad input; missing or expired credentials; service down or slow; out of credit or quota
  - hostile content (prompt injection, phishing links, malformed files); permission and path safety
  - the old version still running after an update; restart; two copies open
  - time zones and dates; money and units; privacy-sensitive data
  - narrow and wide windows, light and dark, keyboard use, reduced motion
- **Acceptance criteria**: the measurable pass condition per scenario.
- **Non-goals**: what is explicitly out.
- **Open questions** and a **Backlog** section for later requests.

## Quality checks before asking for approval

- Every capability has at least one happy-path and one failure scenario.
- Every integration has a feasibility line.
- Every action that affects the outside world has an approval rule.
- A stranger could run the validation from the spec alone.
