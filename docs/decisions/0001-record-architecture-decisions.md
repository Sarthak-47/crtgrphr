# 1. Record architecture decisions

Date: 2026-09-04

## Status

Accepted

## Context

We are two people building Cartographer design-first: we want to discuss and
agree on a decision before writing the code that implements it. Decisions made
in chat or in a call get lost. We need a lightweight, durable record of *what*
we decided and *why*, so that months later (or when onboarding anyone else) the
reasoning is recoverable and we don't re-litigate settled questions.

## Decision

We will use Architecture Decision Records (ADRs), one Markdown file per decision
in `docs/decisions/`, numbered sequentially (`NNNN-title.md`).

Each ADR has: **Status** (proposed / accepted / superseded), **Context** (the
forces at play), **Decision** (what we chose), and **Consequences** (what
follows, good and bad).

Process:
1. An open question lives in `docs/open-questions.md` while we're still arguing.
2. When we agree, we write an ADR capturing the decision and mark the question decided.
3. ADRs are immutable once accepted; to change one, write a new ADR that supersedes it.

## Consequences

- Decisions are traceable and survive personnel/context changes.
- Small ongoing cost: writing a short doc when we lock something.
- `docs/open-questions.md` stays the "what's still up in the air" index; `docs/decisions/` is the "what's settled" record.
