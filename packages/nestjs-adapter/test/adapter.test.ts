import { describe, expect, it } from "vitest";
import {
  MoveRejectedError,
  applyBoardOrderData,
  applyListOrder,
  applyTreeOrder,
  boardChangeToRequest,
  createBoardMoveHandler,
  createBoardPersister,
  createListMoveHandler,
  createTreeMoveHandler,
  getBoardOrderData,
  getTreeOrder,
  httpStatusFor,
  parseMoveRequest,
  sortableMoveToRequest,
  treeMoveToRequest,
  unwrapMoveResponse,
  type MoveStore,
} from "../src";
import { moveNode } from "@gripflow/tree";

interface Card {
  id: string;
  title: string;
}
interface Column {
  id: string;
  title: string;
  cards: Card[];
}
const board = (): Column[] => [
  { id: "todo", title: "To do", cards: [{ id: "a", title: "A" }, { id: "b", title: "B" }] },
  { id: "doing", title: "Doing", cards: [{ id: "c", title: "C" }] },
  { id: "done", title: "Done", cards: [] },
];

function memoryStore<S>(initial: S): MoveStore<S, { user: string }> & { state: S; version: number; saves: number } {
  const store = {
    state: initial,
    version: 1,
    saves: 0,
    async load() {
      return { state: store.state, version: store.version };
    },
    async save(next: S) {
      store.state = next;
      store.version += 1;
      store.saves += 1;
      return { version: store.version };
    },
  };
  return store;
}

describe("parseMoveRequest", () => {
  it("accepts well-formed requests and drops unknown fields", () => {
    const parsed = parseMoveRequest({
      type: "card",
      cardId: "a",
      fromColumnId: "todo",
      toColumnId: "doing",
      toIndex: 1,
      isAdmin: true,
      __proto__: { polluted: true },
    });
    expect(parsed).toEqual({
      ok: true,
      request: { type: "card", cardId: "a", fromColumnId: "todo", toColumnId: "doing", toIndex: 1 },
    });
  });

  it.each([
    [null],
    ["string"],
    [[]],
    [{ type: "nope" }],
    [{ type: "reorder", listId: "l", itemId: "a", toIndex: -1 }],
    [{ type: "reorder", listId: "l", itemId: "a", toIndex: 1.5 }],
    [{ type: "reorder", listId: "", itemId: "a", toIndex: 0 }],
    [{ type: "reorder", listId: "l", itemId: "x".repeat(300), toIndex: 0 }],
    [{ type: "tree", nodeId: "n", toParentId: undefined, toIndex: 0 }],
    [{ type: "card", cardId: {}, fromColumnId: "a", toColumnId: "b", toIndex: 0 }],
    [{ type: "column", columnId: "a", toIndex: Number.POSITIVE_INFINITY }],
  ])("rejects malformed input %#", (input) => {
    expect(parseMoveRequest(input).ok).toBe(false);
  });

  it("allows the root as a tree parent", () => {
    expect(parseMoveRequest({ type: "tree", nodeId: "n", toParentId: null, toIndex: 0 })).toMatchObject({
      ok: true,
      request: { type: "tree", toParentId: null },
    });
  });
});

describe("board handler", () => {
  const card = { type: "card", cardId: "a", fromColumnId: "todo", toColumnId: "doing", toIndex: 1 };

  it("applies a valid move and returns the canonical order and new version", async () => {
    const store = memoryStore(board() as readonly Column[]);
    const handle = createBoardMoveHandler<Column, { user: string }>({ store });
    const res = await handle(card, { user: "u1" });
    expect(res).toEqual({
      ok: true,
      order: { columnOrder: ["todo", "doing", "done"], cards: { todo: ["b"], doing: ["c", "a"], done: [] } },
      version: 2,
    });
    expect(store.saves).toBe(1);
    expect(httpStatusFor(res)).toBe(200);
  });

  it("enforces rules on the server and returns the unchanged canonical order", async () => {
    const store = memoryStore(board() as readonly Column[]);
    const handle = createBoardMoveHandler<Column, { user: string }>({
      store,
      rules: { transitions: { todo: ["doing"] } },
    });
    const res = await handle({ ...card, toColumnId: "done", toIndex: 0 }, { user: "u1" });
    expect(res).toMatchObject({ ok: false, code: "rule-violation", detail: "transition-not-allowed" });
    expect(res.ok ? null : res.order?.cards.todo).toEqual(["a", "b"]);
    expect(store.saves).toBe(0);
    expect(httpStatusFor(res)).toBe(422);
  });

  it("denies unauthorized callers before anything is applied or saved", async () => {
    const store = memoryStore(board() as readonly Column[]);
    const handle = createBoardMoveHandler<Column, { user: string }>({
      store,
      authorize: ({ ctx }) => (ctx.user === "admin" ? true : { ok: false, reason: "Only admins can move cards." }),
    });
    const denied = await handle(card, { user: "guest" });
    expect(denied).toMatchObject({ ok: false, code: "forbidden", message: "Only admins can move cards." });
    expect(store.saves).toBe(0);
    expect((await handle(card, { user: "admin" })).ok).toBe(true);
  });

  it("reports a conflict when the client's idea of the card location is stale", async () => {
    const store = memoryStore(board() as readonly Column[]);
    const handle = createBoardMoveHandler<Column, { user: string }>({ store });
    const res = await handle({ ...card, fromColumnId: "doing" }, { user: "u1" });
    expect(res).toMatchObject({ ok: false, code: "conflict", detail: "stale-location" });
    expect(httpStatusFor(res)).toBe(409);
  });

  it("detects a stale version", async () => {
    const store = memoryStore(board() as readonly Column[]);
    const handle = createBoardMoveHandler<Column, { user: string }>({ store });
    const res = await handle({ ...card, expectedVersion: 0 }, { user: "u1" });
    expect(res).toMatchObject({ ok: false, code: "conflict", detail: "stale-version", version: 1 });
  });

  it("returns not-found for unknown ids and invalid-request for wrong shapes", async () => {
    const handle = createBoardMoveHandler<Column, { user: string }>({
      store: memoryStore(board() as readonly Column[]),
    });
    expect(await handle({ ...card, cardId: "ghost" }, { user: "u" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await handle({ type: "reorder", listId: "x", itemId: "a", toIndex: 0 }, { user: "u" })).toMatchObject({
      ok: false,
      code: "invalid-request",
    });
    expect(await handle("nope", { user: "u" })).toMatchObject({ ok: false, code: "invalid-request" });
  });

  it("treats a no-op move as success without saving", async () => {
    const store = memoryStore(board() as readonly Column[]);
    const handle = createBoardMoveHandler<Column, { user: string }>({ store });
    const res = await handle({ ...card, toColumnId: "todo", toIndex: 0 }, { user: "u" });
    expect(res.ok).toBe(true);
  });

  it("does not leak storage errors", async () => {
    const store = memoryStore(board() as readonly Column[]);
    store.save = async () => {
      throw new Error("connection string postgres://secret@db");
    };
    const handle = createBoardMoveHandler<Column, { user: string }>({ store });
    const res = await handle(card, { user: "u" });
    expect(res).toMatchObject({ ok: false, code: "internal" });
    expect(JSON.stringify(res)).not.toContain("secret");
    expect(httpStatusFor(res)).toBe(500);
  });

  it("reorders columns", async () => {
    const handle = createBoardMoveHandler<Column, { user: string }>({
      store: memoryStore(board() as readonly Column[]),
    });
    const res = await handle({ type: "column", columnId: "done", toIndex: 0 }, { user: "u" });
    expect(res.ok && res.order.columnOrder).toEqual(["done", "todo", "doing"]);
  });
});

describe("list handler", () => {
  it("reorders by id regardless of stale indexes", async () => {
    const store = memoryStore<readonly (string | number)[]>(["a", "b", "c"]);
    const handle = createListMoveHandler<{ user: string }>({ store });
    const res = await handle({ type: "reorder", listId: "l", itemId: "a", toIndex: 2 }, { user: "u" });
    expect(res).toMatchObject({ ok: true, order: { order: ["b", "c", "a"] } });
    expect(await handle({ type: "reorder", listId: "l", itemId: "zzz", toIndex: 0 }, { user: "u" })).toMatchObject({
      ok: false,
      code: "not-found",
    });
    expect(await handle({ type: "reorder", listId: "l", itemId: "a", toIndex: 9 }, { user: "u" })).toMatchObject({
      ok: false,
      code: "invalid-request",
    });
  });
});

interface Node {
  id: string;
  name: string;
  children?: Node[];
}
const tree = (): Node[] => [
  { id: "root", name: "Root", children: [{ id: "child", name: "Child", children: [{ id: "leaf", name: "Leaf" }] }] },
  { id: "other", name: "Other" },
];

describe("tree handler", () => {
  it("rejects a move into a descendant and keeps the stored tree intact", async () => {
    const store = memoryStore(tree() as readonly Node[]);
    const handle = createTreeMoveHandler<Node, { user: string }>({ store });
    const res = await handle({ type: "tree", nodeId: "root", toParentId: "leaf", toIndex: 0 }, { user: "u" });
    expect(res).toMatchObject({ ok: false, code: "rule-violation", detail: "into-descendant" });
    expect(store.saves).toBe(0);
  });

  it("moves a node, preserves its data and returns the canonical order", async () => {
    const store = memoryStore(tree() as readonly Node[]);
    const handle = createTreeMoveHandler<Node, { user: string }>({ store, rules: { maxDepth: 3 } });
    const res = await handle(
      { type: "tree", nodeId: "leaf", fromParentId: "child", toParentId: "other", toIndex: 0 },
      { user: "u" },
    );
    expect(res).toMatchObject({
      ok: true,
      order: { roots: ["root", "other"], children: { root: ["child"], other: ["leaf"] } },
    });
    const saved = store.state.find((n) => n.id === "other");
    expect(saved?.children?.[0]).toEqual({ id: "leaf", name: "Leaf" });
  });

  it("flags a stale parent as a conflict", async () => {
    const handle = createTreeMoveHandler<Node, { user: string }>({ store: memoryStore(tree() as readonly Node[]) });
    const res = await handle(
      { type: "tree", nodeId: "leaf", fromParentId: "root", toParentId: null, toIndex: 0 },
      { user: "u" },
    );
    expect(res).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("canonical order helpers", () => {
  it("applyBoardOrderData keeps card data and ignores unknown ids", () => {
    const cols = board();
    const next = applyBoardOrderData(cols, {
      columnOrder: ["done", "ghost", "todo", "doing"],
      cards: { todo: ["b", "a", "nope"], doing: ["c"], done: [] },
    });
    expect(next.map((c) => c.id)).toEqual(["done", "todo", "doing"]);
    expect(next[1]?.cards.map((c) => c.id)).toEqual(["b", "a"]);
    expect(next[1]?.cards[0]).toBe(cols[0]?.cards[1]);
    expect(getBoardOrderData(cols).cards.todo).toEqual(["a", "b"]);
  });

  it("applyListOrder never drops or duplicates items", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const out = applyListOrder(items, { order: ["c", "c", "zzz", "a"] }, (i) => i.id);
    expect(out.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("applyTreeOrder round-trips getTreeOrder", () => {
    const t = tree();
    const moved = moveNode(t, { id: "leaf", parentId: "other", index: 0 });
    if (!moved.ok) throw new Error("setup failed");
    const rebuilt = applyTreeOrder(t, getTreeOrder(moved.tree));
    expect(getTreeOrder(rebuilt)).toEqual(getTreeOrder(moved.tree));
    expect(rebuilt[0]?.children?.[0]?.name).toBe("Child");
  });

  it("applyTreeOrder survives malformed orders (cycles, duplicates, unknown ids)", () => {
    const t = tree();
    const out = applyTreeOrder(t, {
      roots: ["root", "root", "ghost"],
      children: { root: ["child"], child: ["root", "leaf"], leaf: ["child"] },
    });
    const ids: string[] = [];
    const visit = (nodes: readonly Node[]) =>
      nodes.forEach((n) => {
        ids.push(n.id);
        visit(n.children ?? []);
      });
    visit(out);
    expect(ids.sort()).toEqual(["child", "leaf", "other", "root"]);
  });
});

describe("client helpers", () => {
  it("maps changes to requests", () => {
    expect(
      boardChangeToRequest({ type: "card", cardId: "a", from: { columnId: "todo", index: 0 }, to: { columnId: "doing", index: 1 } }, 3),
    ).toEqual({ type: "card", cardId: "a", fromColumnId: "todo", toColumnId: "doing", toIndex: 1, expectedVersion: 3 });
    expect(boardChangeToRequest({ type: "column", columnId: "x", from: 0, to: 2 })).toEqual({
      type: "column",
      columnId: "x",
      toIndex: 2,
    });
    expect(
      sortableMoveToRequest("l", { activeId: "a", fromContainerId: "l", fromIndex: 0, toContainerId: "l", toIndex: 2 }),
    ).toEqual({ type: "reorder", listId: "l", itemId: "a", toIndex: 2 });
    expect(
      treeMoveToRequest({ id: "n", from: { parentId: null, index: 0 }, to: { parentId: "p", index: 1 } }),
    ).toEqual({ type: "tree", nodeId: "n", fromParentId: null, toParentId: "p", toIndex: 1 });
  });

  it("createBoardPersister applies the server's canonical order", async () => {
    const persist = createBoardPersister<Column>(async () => ({
      ok: true,
      order: { columnOrder: ["todo", "doing", "done"], cards: { todo: ["b"], doing: ["c", "a"], done: [] } },
    }));
    const columns = await persist({
      columns: board(),
      change: { type: "card", cardId: "a", from: { columnId: "todo", index: 0 }, to: { columnId: "done", index: 0 } },
    });
    // The server put the card in "doing", not where the optimistic UI guessed.
    expect(columns.find((c) => c.id === "doing")?.cards.map((c) => c.id)).toEqual(["c", "a"]);
    expect(columns.find((c) => c.id === "done")?.cards).toEqual([]);
  });

  it("createBoardPersister throws MoveRejectedError carrying the canonical order", async () => {
    const persist = createBoardPersister<Column>(async () => ({
      ok: false,
      code: "forbidden",
      message: "No.",
      order: { columnOrder: ["todo"], cards: { todo: ["a"] } },
    }));
    const change = { type: "card", cardId: "a", from: { columnId: "todo", index: 0 }, to: { columnId: "done", index: 0 } } as const;
    await expect(persist({ columns: board(), change })).rejects.toBeInstanceOf(MoveRejectedError);
    try {
      await persist({ columns: board(), change });
    } catch (error) {
      expect(error).toMatchObject({ code: "forbidden", message: "No.", order: { cards: { todo: ["a"] } } });
    }
  });

  it("unwrapMoveResponse returns successes untouched", () => {
    const ok = { ok: true, order: { order: ["a"] } } as const;
    expect(unwrapMoveResponse(ok)).toBe(ok);
  });
});
