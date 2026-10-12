import { describe, expect, it } from "vitest";
import {
  applyBoardOrder,
  canMoveCard,
  canMoveColumn,
  findCard,
  findColumn,
  getBoardOrder,
  moveCard,
  moveColumn,
  validateBoard,
  type KanbanRules,
} from "../src";

interface Card {
  id: string;
  title: string;
  locked?: boolean;
  kind?: "bug" | "feature";
}
interface Column {
  id: string;
  title: string;
  cards: Card[];
  limit?: number;
  locked?: boolean;
}

const board = (): Column[] => [
  { id: "todo", title: "To do", cards: [{ id: "a", title: "A" }, { id: "b", title: "B", kind: "bug" }, { id: "c", title: "C" }] },
  { id: "doing", title: "Doing", cards: [{ id: "d", title: "D" }] },
  { id: "done", title: "Done", cards: [] },
];

const ids = (columns: readonly Column[]) => Object.fromEntries(columns.map((c) => [c.id, c.cards.map((x) => x.id)]));

describe("lookup & validation", () => {
  it("finds cards and columns by stable id", () => {
    const b = board();
    expect(findCard(b, "d")).toMatchObject({ index: 0, columnIndex: 1 });
    expect(findCard(b, "zzz")).toBeNull();
    expect(findColumn(b, "done")).toMatchObject({ index: 2 });
    expect(findColumn(b, "x")).toBeNull();
  });

  it("detects duplicate ids", () => {
    const b = board();
    b[1]?.cards.push({ id: "a", title: "dup" });
    expect(validateBoard(b)).toEqual(['Duplicate card id "a".']);
    expect(validateBoard([...board(), ...board()])).not.toEqual([]);
    expect(validateBoard(board())).toEqual([]);
  });
});

describe("moveCard", () => {
  it("reorders inside a column", () => {
    const result = moveCard(board(), { cardId: "a", toColumnId: "todo", toIndex: 2 });
    expect(result.ok && ids(result.columns)).toEqual({ todo: ["b", "c", "a"], doing: ["d"], done: [] });
    if (result.ok) expect(result.change).toEqual({ type: "card", cardId: "a", from: { columnId: "todo", index: 0 }, to: { columnId: "todo", index: 2 } });
  });

  it("moves between columns, into empty columns, and preserves card data", () => {
    const input = board();
    const result = moveCard(input, { cardId: "b", toColumnId: "done", toIndex: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.columns)).toEqual({ todo: ["a", "c"], doing: ["d"], done: ["b"] });
    expect(result.columns[2]?.cards[0]).toEqual({ id: "b", title: "B", kind: "bug" });
    expect(result.columns[2]?.cards[0]).toBe(input[0]?.cards[1]); // not cloned
    expect(result.columns[1]).toBe(input[1]); // untouched column keeps identity
  });

  it("inserts at a given position in a populated column", () => {
    const result = moveCard(board(), { cardId: "a", toColumnId: "doing", toIndex: 0 });
    expect(result.ok && ids(result.columns).doing).toEqual(["a", "d"]);
  });

  it("never mutates the input", () => {
    const input = board();
    const snapshot = JSON.stringify(input);
    moveCard(input, { cardId: "a", toColumnId: "done", toIndex: 0 });
    moveCard(input, { cardId: "a", toColumnId: "todo", toIndex: 2 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("uses ids rather than positions: a stale index cannot move the wrong card", () => {
    const afterFilter = board().map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== "a") }));
    const result = moveCard(afterFilter, { cardId: "b", toColumnId: "todo", toIndex: 1 });
    expect(result.ok && ids(result.columns).todo).toEqual(["c", "b"]);
  });

  it("rejects unknown ids and bad indexes", () => {
    expect(moveCard(board(), { cardId: "x", toColumnId: "done", toIndex: 0 })).toMatchObject({ ok: false, reason: "card-not-found" });
    expect(moveCard(board(), { cardId: "a", toColumnId: "nope", toIndex: 0 })).toMatchObject({ ok: false, reason: "column-not-found" });
    expect(moveCard(board(), { cardId: "a", toColumnId: "done", toIndex: 1 })).toMatchObject({ ok: false, reason: "invalid-index" });
    expect(moveCard(board(), { cardId: "a", toColumnId: "todo", toIndex: 3 })).toMatchObject({ ok: false, reason: "invalid-index" });
    expect(moveCard(board(), { cardId: "a", toColumnId: "done", toIndex: -1 })).toMatchObject({ ok: false, reason: "invalid-index" });
  });

  it("reports a move to the same place as no-op", () => {
    expect(moveCard(board(), { cardId: "b", toColumnId: "todo", toIndex: 1 })).toMatchObject({ ok: false, reason: "no-op" });
  });

  describe("rules", () => {
    it("locked cards cannot move", () => {
      const b = board();
      (b[0] as Column).cards[0] = { id: "a", title: "A", locked: true };
      const rules: KanbanRules<Column> = { isCardLocked: (card) => !!card.locked };
      expect(moveCard(b, { cardId: "a", toColumnId: "done", toIndex: 0 }, rules)).toMatchObject({ ok: false, reason: "locked" });
      expect(moveCard(b, { cardId: "a", toColumnId: "todo", toIndex: 1 }, rules)).toMatchObject({ ok: false, reason: "locked" });
      expect(moveCard(b, { cardId: "b", toColumnId: "done", toIndex: 0 }, rules).ok).toBe(true);
    });

    it("column-level acceptance with a reason", () => {
      const rules: KanbanRules<Column> = {
        acceptsCard: (to, card) => (to.id === "done" && card.kind === "bug" ? { ok: false, reason: "Bugs need review first" } : true),
      };
      expect(moveCard(board(), { cardId: "b", toColumnId: "done", toIndex: 0 }, rules)).toMatchObject({
        ok: false,
        reason: "not-accepted",
        message: "Bugs need review first",
      });
      expect(moveCard(board(), { cardId: "a", toColumnId: "done", toIndex: 0 }, rules).ok).toBe(true);
    });

    it("WIP limits only apply to cards arriving from another column", () => {
      const rules: KanbanRules<Column> = { maxCards: (c) => (c.id === "doing" ? 1 : undefined) };
      expect(moveCard(board(), { cardId: "a", toColumnId: "doing", toIndex: 0 }, rules)).toMatchObject({ ok: false, reason: "limit-reached" });
      // reordering inside a full column is fine
      const full = board();
      (full[1] as Column).cards.push({ id: "e", title: "E" });
      const limit2: KanbanRules<Column> = { maxCards: () => 2 };
      expect(moveCard(full, { cardId: "d", toColumnId: "doing", toIndex: 1 }, limit2).ok).toBe(true);
    });

    it("workflow transitions", () => {
      const rules: KanbanRules<Column> = { transitions: { todo: ["doing"], doing: ["todo", "done"] } };
      expect(moveCard(board(), { cardId: "a", toColumnId: "done", toIndex: 0 }, rules)).toMatchObject({ ok: false, reason: "transition-not-allowed" });
      expect(moveCard(board(), { cardId: "a", toColumnId: "doing", toIndex: 0 }, rules).ok).toBe(true);
      expect(moveCard(board(), { cardId: "a", toColumnId: "todo", toIndex: 2 }, rules).ok).toBe(true);
      // columns without an entry are unrestricted
      expect(moveCard(board(), { cardId: "d", toColumnId: "done", toIndex: 0 }, rules).ok).toBe(true);
    });

    it("custom veto", () => {
      const rules: KanbanRules<Column> = { canMoveCard: ({ to }) => to.id !== "done" };
      expect(canMoveCard(board(), { cardId: "a", toColumnId: "done", toIndex: 0 }, rules)).toMatchObject({ ok: false, reason: "rejected" });
    });
  });
});

describe("moveColumn", () => {
  it("reorders columns by id", () => {
    const result = moveColumn(board(), { columnId: "done", toIndex: 0 });
    expect(result.ok && result.columns.map((c) => c.id)).toEqual(["done", "todo", "doing"]);
    if (result.ok) expect(result.change).toEqual({ type: "column", columnId: "done", from: 2, to: 0 });
  });

  it("rejects locked columns, bad indexes, unknown ids and no-ops", () => {
    const rules: KanbanRules<Column> = { isColumnLocked: (c) => c.id === "todo" };
    expect(moveColumn(board(), { columnId: "todo", toIndex: 1 }, rules)).toMatchObject({ ok: false, reason: "locked" });
    expect(moveColumn(board(), { columnId: "done", toIndex: 5 })).toMatchObject({ ok: false, reason: "invalid-index" });
    expect(moveColumn(board(), { columnId: "zzz", toIndex: 0 })).toMatchObject({ ok: false, reason: "column-not-found" });
    expect(moveColumn(board(), { columnId: "doing", toIndex: 1 })).toMatchObject({ ok: false, reason: "no-op" });
    expect(canMoveColumn(board(), { columnId: "done", toIndex: 0 }, { canMoveColumn: () => ({ ok: false, reason: "no" }) })).toMatchObject({
      ok: false,
      message: "no",
    });
  });
});

describe("ordering import/export", () => {
  it("exports the order and re-applies it to a shuffled board", () => {
    const original = board();
    const order = getBoardOrder(original);
    expect(order).toEqual({ columnOrder: ["todo", "doing", "done"], cards: { todo: ["a", "b", "c"], doing: ["d"], done: [] } });
    const moved = moveCard(original, { cardId: "a", toColumnId: "done", toIndex: 0 });
    if (!moved.ok) throw new Error("setup");
    const restored = applyBoardOrder(moved.columns, order);
    expect(ids(restored)).toEqual(ids(original));
  });

  it("applies a server-canonical order, keeping all card data", () => {
    const result = applyBoardOrder(board(), {
      columnOrder: ["done", "todo", "doing"],
      cards: { done: ["c"], todo: ["b", "a"], doing: ["d"] },
    });
    expect(result.map((c) => c.id)).toEqual(["done", "todo", "doing"]);
    expect(ids(result)).toEqual({ done: ["c"], todo: ["b", "a"], doing: ["d"] });
    expect(findCard(result, "b")?.card).toEqual({ id: "b", title: "B", kind: "bug" });
  });

  it("is forgiving: ignores unknown ids and never drops cards a stale order forgot", () => {
    const result = applyBoardOrder(board(), { cards: { todo: ["ghost", "c"], doing: ["a"] } });
    // c and a are placed as told; b (unmentioned) stays in its column after the ordered cards
    expect(ids(result)).toEqual({ todo: ["c", "b"], doing: ["a", "d"], done: [] });
    expect(result.flatMap((c) => c.cards)).toHaveLength(4);
  });
});
