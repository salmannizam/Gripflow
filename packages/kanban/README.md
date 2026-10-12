# @gripflow/kanban

**Kanban board drag and drop for React.** Move cards between columns, reorder columns, enforce WIP
limits and workflow transitions, support keyboard moves (Alt+Arrow keys) and save changes with
optimistic updates and automatic rollback. Headless: you own every element and class name.

```bash
npm install @gripflow/kanban @gripflow/react
```

The package has a pure part (`@gripflow/kanban`: `moveCard`, `moveColumn`, `canMoveCard`, rules) that
works without React, and the React part under `@gripflow/kanban/react`.

## Usage

```tsx
"use client";
import { useState } from "react";
import { KanbanBoard } from "@gripflow/kanban/react";

type Card = { id: string; title: string };
type Column = { id: string; title: string; cards: Card[] };

export function Board({ initial }: { initial: Column[] }) {
  const [columns, setColumns] = useState(initial);
  return (
    <KanbanBoard
      columns={columns}
      onChange={(next) => setColumns([...next])}
      rules={{ transitions: { todo: ["doing"], doing: ["todo", "done"] } }}
      onMoveRejected={(failure) => console.warn(failure.message)}
      renderBoard={(cols) => <div className="board">{cols}</div>}
      renderColumn={(state, cards) => (
        <section ref={state.setNodeRef} className="column">
          <h3>{state.column.title}</h3>
          {cards}
        </section>
      )}
      renderCard={(card, state) => (
        <div ref={state.setNodeRef} style={state.style} {...state.attributes} className="card">
          {card.title}
        </div>
      )}
    />
  );
}
```

Use `useOptimisticBoard(initial, { persist })` to update the UI immediately, save in order and roll
back if the server rejects a move. Pair it with
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter) for the server side.

MIT licensed.
