# 7. Edge routing and shared drawing geometry

Date: 2026-11-04

## Status

Accepted

## Context

M1 drew edges two different ways: React Flow's built-in `smoothstep` path on the
canvas, and a simple orthogonal router in the SVG exporter. They didn't match, and
neither knew about obstacles, so long edges cut straight through nodes, back edges
in cycles crossed their own nodes, and several edges leaving one node side merged
into a single line. Decision diamonds were drawn as rotated rectangles.

ELK (ADR-0004) already computes good orthogonal routes that avoid nodes and reserve
room for labels, but those routes are only valid while nodes stay where ELK put
them. With pin-and-reflow, the user can move a node at any time.

## Decision

1. **One geometry module for screen and export.** `src/renderer/src/render/geometry.ts`
   owns shape outlines, text areas, ports and routing. The canvas (custom node and
   edge components) and the SVG exporter both draw from it, so they cannot drift.
2. **Prefer ELK's routes, validated.** Every edge uses the route ELK produced, as
   long as its endpoints still lie on the current borders of both nodes (on a
   vertex, for diamonds). Otherwise, typically right after a drag, the edge falls
   back to the local router until the next auto-layout.
3. **The local router** is orthogonal with rounded corners. It spreads edges that
   share a node side across that side (ordered by where the other end is), staggers
   fan-out bends so they nest instead of overlapping, and loops back edges around
   both nodes.
4. **Decisions connect at their vertices**, flowchart-style, using fixed ELK ports:
   input on the near vertex, the first branch from the far vertex, further branches
   from the side vertices.
5. **Sequence diagrams are not graphs.** They use their own column/row layout and
   message routes (`layout/sequence.ts`, `render/sequence.ts`) and keep no layout
   layer, since every position is derived from node and edge order.

## Consequences

- The canvas and exports look identical, and edges no longer cut through nodes in
  laid-out maps.
- While a node is being dragged, the edges touching it use simpler local routes;
  clicking Auto-layout restores ELK-quality routing.
- Edge order in the IR now carries meaning in two places: the branch a decision
  uses, and message order in sequences. The edge inspector exposes message order.
- More layout work happens in ELK (labels, ports), so maps are somewhat wider; the
  layer gap was reduced to compensate.
