# 4. Layout engine and override model

Date: 2026-09-06

## Status

Accepted

## Context

The authored IR has no coordinates (ADR-0003), so an engine must compute layout.
And because the tool is editable — not frozen output — we must define what happens
when a human drags a node. This is precisely the UX crux Archify never resolved:
either the machine's layout is sacred (users can't fix it) or the human's edits
are sacred (the layout drifts into a mess as the graph changes).

Engine options: ELK (layered, orthogonal routing, crossing minimization — proven
in our deleted spike), dagre (simpler/lighter, less capable routing), or custom
(a rabbit hole). Override options: free drag (sticks forever), snap-back (auto
always wins), or pin-and-reflow.

## Decision

- **Engine: ELK** (`elkjs`), layered algorithm with orthogonal edge routing.
- **Override model: pin-and-reflow.** Dragging a node **pins** it. Re-running
  auto-layout keeps pinned nodes fixed and re-flows all unpinned nodes around
  them. Users can unpin a node to return it to automatic control. Pins are stored
  in the separate layout layer (`{ x, y, pinned: true }`), not in the semantic IR.

## Consequences

- Users get structure *and* control: the machine does the tedious arrangement,
  the human fixes the few things that matter and those stick.
- Adding/removing nodes re-flows cleanly around the user's intentional anchors,
  instead of either ignoring edits or scrambling the whole map.
- Requires the separate layout layer from ADR-0003 to be in place first.
- ELK integration is a meaningful chunk of work (~M) and its bundle is sizeable,
  accepted for the layout quality. dagre remains a fallback if ELK proves too heavy.
