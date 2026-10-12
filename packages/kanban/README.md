<div align="center">

# @gripflow/kanban

**Drag-and-drop Kanban board for React and Next.js.**
Move cards between columns, reorder columns, enforce workflow rules and WIP limits, save with optimistic updates.

[![npm](https://img.shields.io/npm/v/@gripflow/kanban?color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/kanban)
[![types](https://img.shields.io/npm/types/@gripflow/kanban)](https://www.npmjs.com/package/@gripflow/kanban)
[![license](https://img.shields.io/npm/l/@gripflow/kanban)](https://github.com/salmannizam/Gripflow/blob/main/LICENSE)

</div>

Build a Trello- or Jira-style board without writing drag-and-drop logic. You describe your columns and
cards as plain data and draw them however you like (Tailwind, Bootstrap, CSS Modules...). Gripflow
handles dragging, keyboard moves, rules and accessibility.

- Drag cards inside a column and across columns, drag columns to reorder
- **Rules**: locked cards or columns, WIP limits, allowed workflow transitions, custom checks
- **Optimistic updates** with automatic rollback if your server rejects a move
- Keyboard support: `Space` pick up / drop, arrows to move, `Alt + Arrow keys` as a shortcut, `Esc` to cancel
- Screen-reader announcements
- A pure, framework-free part (`moveCard`, `moveColumn`...) that works on the server and in tests

## Install

```bash
npm install @gripflow/kanban @gripflow/react
```

Requires React 18 or 19. Import the React parts from `@gripflow/kanban/react` and the pure functions
from `@gripflow/kanban`.

## Quick start

```tsx
"use client";

import { useState } from "react";
import { KanbanBoard } from "@gripflow/kanban/react";

type Card = { id: string; title: string };
type Column = { id: string; title: string; cards: Card[] };

const initial: Column[] = [
  { id: "todo", title: "To do", cards: [{ id: "c1", title: "Design the logo" }, { id: "c2", title: "Write the docs" }] },
  { id: "doing", title: "In progress", cards: [{ id: "c3", title: "Build the board" }] },
  { id: "done", title: "Done", cards: [] },
];

export function Board() {
  const [columns, setColumns] = useState(initial);

  return (
    <KanbanBoard
      columns={columns}
      onChange={(next) => setColumns([...next])}
      renderBoard={(cols) => <div style={{ display: "flex", gap: 16 }}>{cols}</div>}
      renderColumn={(state, cards) => (
        <section
          ref={state.setNodeRef}
          style={{ ...state.style, width: 260, padding: 12, background: state.isDropTarget ? "#eef2ff" : "#f4f4f5" }}
        >
          <h3>{state.column.title} ({state.cardCount})</h3>
          <div style={{ display: "grid", gap: 8, minHeight: 40 }}>{cards}</div>
        </section>
      )}
      renderCard={(card, state) => (
        <article
          ref={state.setNodeRef}
          style={{ ...state.style, padding: 10, background: "white", opacity: state.isDragging ? 0.4 : 1 }}
          {...state.attributes}
        >
          {card.title}
        </article>
      )}
      renderOverlay={(info) =>
        info.card ? <article style={{ padding: 10, background: "white", boxShadow: "0 8px 24px #0003" }}>{info.card.title}</article> : null
      }
    />
  );
}
```

How it works:

- Your board is an **array of columns**, each with a `cards` array. Add any extra fields you want (`title`, `assignee`...).
- `onChange` gives you the **next board**. Store it in state (and save it to your API).
- `renderColumn` receives the column state and the already-rendered `cards` to place inside.
- `renderCard` receives the card and its state: attach `setNodeRef`, `style` and spread `attributes`.
- `renderOverlay` draws the floating card while dragging. Omit it to move the real element instead.

## Rules: locking, WIP limits, workflows

```tsx
<KanbanBoard
  columns={columns}
  onChange={(next) => setColumns([...next])}
  rules={{
    // Locked cards cannot be moved at all.
    isCardLocked: (card) => card.id === "c3",
    // Locked columns cannot be reordered (their cards can still move).
    isColumnLocked: (column) => column.id === "done",
    // WIP limit: only enforced when a card arrives from another column.
    maxCards: (column) => (column.id === "doing" ? 3 : undefined),
    // Allowed workflow: todo -> doing -> done. Moving inside a column is always allowed.
    transitions: { todo: ["doing"], doing: ["todo", "done"] },
    // Final custom veto.
    canMoveCard: ({ card, to }) =>
      to.id === "done" && card.title.length === 0 ? { ok: false, reason: "Give the card a title first." } : true,
  }}
  onMoveRejected={(failure) => toast(failure.message)}
  …
/>
```

`onMoveRejected` receives a human-readable `message` (safe to show in your UI) and a `reason` code:
`locked`, `not-accepted`, `limit-reached`, `transition-not-allowed`, `rejected`, ...

You can show why a drop is refused while hovering: `state.isInvalidOver` and `state.rejectionReason` are
available on the column state. Do not rely on color alone; show text or an icon.

## Save to your server (optimistic updates with rollback)

`useOptimisticBoard` updates the UI immediately, saves moves one at a time in order, and rolls back to
the last confirmed board if a save fails.

```tsx
"use client";

import { KanbanBoard, useOptimisticBoard } from "@gripflow/kanban/react";

export function Board({ initial }: { initial: Column[] }) {
  const board = useOptimisticBoard(initial, {
    persist: async ({ change }) => {
      const res = await fetch("/api/board/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!res.ok) throw new Error("Move rejected"); // throwing rolls the board back
    },
    onRejected: ({ error }) => console.warn("Rolled back:", error),
  });

  return (
    <KanbanBoard
      columns={board.columns}
      onChange={board.onChange}
      renderColumn={…}
      renderCard={…}
    />
  );
}
```

- `persist` may **return the server's board** (`Column[]`) to replace the optimistic guess, so the UI always matches the server.
- `board.pending` is how many saves are in flight; `board.rejection` is the most recent failure.
- `change` describes what moved: `{ type: "card", cardId, from: { columnId, index }, to: { columnId, index } }` or `{ type: "column", columnId, from, to }`.

For a ready-made, **validated** server endpoint (rules and permission checks re-run on the server),
use [`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter). Never trust the
browser alone for rules that matter.

## Keyboard and accessibility

| Key | Action |
| --- | --- |
| `Tab` | Focus a card |
| `Space` | Pick up / drop |
| `Arrow keys` | Move while picked up |
| `Esc` | Cancel |
| `Alt + ↑ / ↓` | Move the focused card up / down in its column |
| `Alt + ← / →` | Move the focused card to the previous / next column |

Moves are announced to screen readers. Please still test with your own assistive technology before
making conformance claims.

## Pure functions (no React)

Useful on the server, in tests, or with other frameworks:

```ts
import { moveCard, moveColumn, canMoveCard, validateBoard } from "@gripflow/kanban";

const result = moveCard(columns, { cardId: "c1", toColumnId: "doing", toIndex: 0 }, rules);
if (result.ok) {
  save(result.columns); // new board, input is never mutated
  console.log(result.change); // what changed
} else {
  console.log(result.reason, result.message); // e.g. "limit-reached"
}
```

`toIndex` is the position in the destination column **after** the card has left its old place.

## Props reference (`KanbanBoard`)

| Prop | Description |
| --- | --- |
| `columns` | **Required.** `{ id, cards: [{ id }] }[]` plus any fields you like |
| `onChange(columns, change)` | Called with the next board after an accepted move |
| `renderColumn(state, cards)` | **Required.** Draw a column; attach `state.setNodeRef` |
| `renderCard(card, state, column)` | **Required.** Draw a card; attach `state.setNodeRef`, `state.style`, spread `state.attributes` |
| `renderOverlay(info)` | Floating preview (`info.type`, `info.card`, `info.column`) |
| `renderBoard(columns)` | Wrap all columns (e.g. in a flex container) |
| `rules` | `isCardLocked`, `isColumnLocked`, `acceptsCard`, `maxCards`, `transitions`, `canMoveCard`, `canMoveColumn` |
| `onMoveRejected(failure, attempted)` | A move was refused by the rules |
| `getCardLabel`, `getColumnLabel` | Names used in screen-reader announcements (defaults: `title`, `name` or `label`) |
| …provider props | `sensors`, `modifiers`, `autoScroll`, `animation`, … |

## Troubleshooting

- **Nothing happens in Next.js**: add `"use client"` at the top of the file.
- **Cards snap back**: update your state in `onChange`.
- **Empty columns don't accept drops**: attach `state.setNodeRef` to the column element and give it a `min-height`.
- **Card ids must be unique across the whole board**, not just within a column.
- **Rolled back unexpectedly**: your `persist` threw or rejected. Check the network response.

## Related packages

[`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) ·
[`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) ·
[`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react) ·
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter)

## Author

Created and maintained by [salmannizam](https://github.com/salmannizam). Issues and ideas are welcome on
[GitHub](https://github.com/salmannizam/Gripflow/issues). MIT licensed.
