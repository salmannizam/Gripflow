# @gripflow/nestjs-adapter

Server-side helpers for saving Gripflow drag-and-drop moves safely: list reorders, Kanban card and
column moves, and tree moves. It validates untrusted request bodies, checks your rules and
permissions on the server, and returns the canonical order so the client can resync. It does **not**
depend on NestJS: use it from NestJS, Express, Next.js route handlers or any Node backend.

```bash
npm install @gripflow/nestjs-adapter
```

## Server

```ts
import { createBoardMoveHandler, httpStatusFor, type MoveStore } from "@gripflow/nestjs-adapter";

type Card = { id: string; title: string };
type Column = { id: string; title: string; cards: Card[] };

const store: MoveStore<readonly Column[], { userId: string }> = {
  async load(_request, ctx) {
    return { state: await db.loadBoard(ctx.userId) };
  },
  async save(next, { ctx }) {
    await db.saveBoard(ctx.userId, next); // use a transaction or row lock for concurrent writers
  },
};

const handleMove = createBoardMoveHandler<Column, { userId: string }>({
  store,
  rules: { transitions: { todo: ["doing"] } },
  authorize: ({ ctx, state }) => canEdit(ctx.userId, state),
});

// In your route (any framework):
//   const result = await handleMove(body, { userId });
//   respond(result.ok ? 200 : httpStatusFor(result.code), result);
```

Handlers never throw and never leak internal errors. Rejections include the current server order and
a `code` such as `rule-violation`, `forbidden`, `conflict`, `not-found` or `invalid-request`.
`createListMoveHandler` and `createTreeMoveHandler` work the same way. Send `expectedVersion` from the
client (via `getVersion`) to detect stale writes.

## Client

```ts
import { createBoardPersister } from "@gripflow/nestjs-adapter";
import { useOptimisticBoard } from "@gripflow/kanban/react";

const board = useOptimisticBoard(initialColumns, {
  persist: createBoardPersister(async (request) => {
    const res = await fetch("/api/move", { method: "POST", body: JSON.stringify(request) });
    return res.json();
  }),
});
// <KanbanBoard columns={board.columns} onChange={board.onChange} ... />
```

On a rejected move the board rolls back; the thrown `MoveRejectedError` carries the server's order.

MIT licensed.
