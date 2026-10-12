<div align="center">

# @gripflow/nestjs-adapter

**Safely save drag-and-drop changes on your server.**
Validated move requests, server-side rules and permission checks, and optimistic-update helpers for NestJS, Express, Next.js route handlers or any Node backend.

[![npm](https://img.shields.io/npm/v/@gripflow/nestjs-adapter?color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/nestjs-adapter)
[![types](https://img.shields.io/npm/types/@gripflow/nestjs-adapter)](https://www.npmjs.com/package/@gripflow/nestjs-adapter)
[![license](https://img.shields.io/npm/l/@gripflow/nestjs-adapter)](https://github.com/salmannizam/Gripflow/blob/main/LICENSE)

</div>

The browser can be wrong, stale, or malicious, so a drag-and-drop UI should never be the only place
where your rules are enforced. This package gives you the server half:

- **Validates** untrusted request bodies (never throws, never leaks internals)
- **Re-checks your rules on the server**: Kanban WIP limits and transitions, tree depth and hierarchy
- **Authorization hook**: decide who may move what
- **Conflict detection**: stale state is detected and the server's canonical order is sent back
- **Client helpers** for optimistic updates with rollback
- **Framework-agnostic**: despite the name it has **no NestJS dependency**. Use it from NestJS, Express, Fastify, Hono, serverless functions or Next.js route handlers

You bring the database (through a small `MoveStore`) and the HTTP layer. This package never makes network
calls itself.

## Install

```bash
npm install @gripflow/nestjs-adapter
```

It uses `@gripflow/kanban` and `@gripflow/tree` for the move rules (installed automatically).

## How it works

```
Browser                              Your server
-------                              -----------
drag a card ──► UI updates instantly
            ──► POST /api/move  ───►  handler(body, ctx)
                                       1. validate the payload
                                       2. load current state (your database)
                                       3. authorize (your permission check)
                                       4. check version / apply rules
                                       5. save (your database)
            ◄── { ok, order }  ◄───   returns the canonical order
UI matches the server order
(or rolls back if { ok: false })
```

## Server: a Kanban board endpoint

```ts
import {
  createBoardMoveHandler,
  httpStatusFor,
  type MoveStore,
} from "@gripflow/nestjs-adapter";

type Card = { id: string; title: string };
type Column = { id: string; title: string; cards: Card[] };
type Ctx = { userId: string };

// 1. Tell the handler how to load and save the board (your database code).
const store: MoveStore<readonly Column[], Ctx> = {
  async load(_request, ctx) {
    const board = await db.boards.findForUser(ctx.userId);
    return { state: board.columns, version: board.version };
  },
  async save(next, { ctx }) {
    const version = await db.boards.replaceColumns(ctx.userId, next);
    return { version };
  },
};

// 2. Create the handler once. Rules are enforced here, on the server.
export const moveHandler = createBoardMoveHandler<Column, Ctx>({
  store,
  rules: {
    maxCards: (column) => (column.id === "doing" ? 5 : undefined),
    transitions: { todo: ["doing"], doing: ["todo", "done"] },
  },
  authorize: ({ ctx, state }) => canEditBoard(ctx.userId, state),
});

// 3. Call it from any route. The handler never throws.
export async function POST(request: Request) {
  const userId = await getUserId(request); // your auth
  const response = await moveHandler(await request.json(), { userId });
  return Response.json(response, { status: httpStatusFor(response) });
}
```

The example above is a Next.js route handler (`app/api/board/move/route.ts`). The same handler works
unchanged in any framework.

### NestJS controller

```ts
@Controller("board")
export class BoardController {
  @Post("move")
  async move(@Body() body: unknown, @Req() req: AuthedRequest, @Res() res: Response) {
    const response = await moveHandler(body, { userId: req.user.id });
    res.status(httpStatusFor(response)).json(response);
  }
}
```

### Express

```ts
app.post("/api/board/move", async (req, res) => {
  const response = await moveHandler(req.body, { userId: req.user.id });
  res.status(httpStatusFor(response)).json(response);
});
```

## Other handlers

| Handler | Request `type` | State you store |
| --- | --- | --- |
| `createBoardMoveHandler` | `"card"`, `"column"` | `Column[]` with `cards` |
| `createListMoveHandler` | `"reorder"` | Ordered id list |
| `createTreeMoveHandler` | `"tree"` | Nested nodes (`{ id, children? }`) |

All three take `{ store, authorize? }` (board and tree also take `rules`), and return a function
`(body: unknown, ctx) => Promise<MoveResponse>`.

## Client: optimistic updates with rollback (Kanban)

```tsx
"use client";

import { KanbanBoard, useOptimisticBoard } from "@gripflow/kanban/react";
import { createBoardPersister, isMoveRejectedError } from "@gripflow/nestjs-adapter";

export function Board({ initial }: { initial: Column[] }) {
  const board = useOptimisticBoard(initial, {
    persist: createBoardPersister<Column>(async (request) => {
      const res = await fetch("/api/board/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      return res.json(); // the server's MoveResponse
    }),
    onRejected: ({ error }) => {
      if (isMoveRejectedError(error)) toast(error.message); // e.g. "A column may hold at most 5 cards."
    },
  });

  return <KanbanBoard columns={board.columns} onChange={board.onChange} renderColumn={…} renderCard={…} />;
}
```

What happens: the UI updates instantly; the request is sent; on success the board is replaced with the
**server's canonical order**; on rejection the board **rolls back** and `onRejected` receives a
`MoveRejectedError` with a safe-to-show `message`, a `code`, and the server's current `order`.

### Lists and trees

```ts
import { sortableMoveToRequest, treeMoveToRequest } from "@gripflow/nestjs-adapter";

// SortableList / useSortable:  onItemsChange={(next, move) => send(sortableMoveToRequest("my-list", move))}
// TreeDnd:                      onChange={(next, move) => send(treeMoveToRequest(move))}
```

## Responses

Success: `{ ok: true, order, version? }`.
Rejection: `{ ok: false, code, message, detail?, order?, version? }`.

| `code` | Meaning | `httpStatusFor` |
| --- | --- | --- |
| `invalid-request` | Payload failed validation | 400 |
| `forbidden` | Your `authorize` said no | 403 |
| `not-found` | Item, column or parent does not exist | 404 |
| `conflict` | The client was stale, use the returned `order` to resync | 409 |
| `rule-violation` | A rule such as WIP limit or hierarchy blocked it (see `detail`) | 422 |
| `internal` | Your `store` threw. Details are not leaked | 500 |

## Concurrency and security notes

- Send `expectedVersion` (via the `getVersion` option of `createBoardPersister`) and return a `version`
  from your store to detect stale writes.
- Between `load` and `save`, two requests can race. Use a database transaction or row lock if that matters;
  this package cannot do it for you.
- Always run your own authentication before calling the handler, and use `authorize` for per-item permissions.
- Errors thrown by your `store` or `authorize` become an `internal` response, never a stack trace.

## Pure helpers

`parseMoveRequest(body)`, `applyBoardRequest`, `applyReorderRequest`, `applyTreeRequest`,
`getBoardOrderData` / `applyBoardOrderData`, `getListOrder` / `applyListOrder`, `getTreeOrder` /
`applyTreeOrder`, `createMoveHandler` (build a handler for your own request type).

## Related packages

[`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) ·
[`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) ·
[`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) ·
[`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react)

## Author

Created and maintained by [salmannizam](https://github.com/salmannizam). Issues and ideas are welcome on
[GitHub](https://github.com/salmannizam/Gripflow/issues). MIT licensed.
