# 6. Licensing: clean-room build, credit Archify

Date: 2026-09-06

## Status

Accepted

## Context

Cartographer is inspired by Archify (github.com/tt-a1i/archify), which is
MIT-licensed and itself based on `Cocoon-AI/architecture-diagram-generator`.
Ideas and general approaches are not protected — we can freely take inspiration
from Archify's concepts (typed IR, semantic roles, reach tracing, share cards).
Copying its *source code*, however, would carry its MIT license and attribution
obligations into our codebase.

We want a clean ownership story and full control over our own licensing.

## Decision

Build **clean-room**: implement from our own design and code, taking *ideas* from
Archify but not its source. Add a `NOTICE` file that credits Archify (and, through
it, Cocoon-AI) as conceptual inspiration. If at any point we deliberately choose
to reuse a piece of Archify's MIT code, we will vendor it in isolation with its
license header preserved and note it in `NOTICE` and `THIRD_PARTY_NOTICES`.

We will choose our own project license separately (leaning permissive), tracked
as a future decision.

## Consequences

- Clear IP: our code is ours, unencumbered by third-party license terms.
- We honor the spirit of the ecosystem by crediting the inspiration in `NOTICE`.
- Slightly more work than lifting code, but avoids license entanglement.
- A concrete rule exists for the exception case (isolated, attributed vendoring)
  so we don't have to re-decide under pressure.
