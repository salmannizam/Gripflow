import { arrayInsert, arrayMove, arrayRemove, type UniqueId } from "@gripflow/core";
import type {
  BoardFailure,
  BoardResult,
  CardLocation,
  CardMove,
  CardOf,
  ColumnMove,
  KanbanColumnShape,
  KanbanRules,
  RuleVerdict,
} from "./types";

function fail(reason: BoardFailure["reason"], message: string): BoardFailure {
  return { ok: false, reason, message };
}

function verdictToFailure(verdict: RuleVerdict, fallback: string): BoardFailure | null {
  const ok = typeof verdict === "boolean" ? verdict : verdict.ok;
  if (ok) return null;
  const reason = typeof verdict === "boolean" ? undefined : verdict.reason;
  return fail("rejected", reason ?? fallback);
}

export interface CardEntry<Col extends KanbanColumnShape> {
  readonly card: CardOf<Col>;
  readonly column: Col;
  readonly columnIndex: number;
  readonly index: number;
}

/** Finds a column by id. */
export function findColumn<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  columnId: UniqueId,
): { readonly column: Col; readonly index: number } | null {
  const index = columns.findIndex((c) => c.id === columnId);
  const column = columns[index];
  return column === undefined ? null : { column, index };
}

/** Finds a card anywhere on the board. */
export function findCard<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  cardId: UniqueId,
): CardEntry<Col> | null {
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    const column = columns[columnIndex] as Col;
    const index = column.cards.findIndex((c) => c.id === cardId);
    if (index >= 0) return { card: column.cards[index] as CardOf<Col>, column, columnIndex, index };
  }
  return null;
}

/**
 * Reports problems that would make moves ambiguous: duplicate column ids or a card id used
 * twice anywhere on the board. Returns human readable messages (empty when the board is valid).
 */
export function validateBoard<Col extends KanbanColumnShape>(columns: readonly Col[]): string[] {
  const problems: string[] = [];
  const columnIds = new Set<UniqueId>();
  const cardIds = new Set<UniqueId>();
  for (const column of columns) {
    if (columnIds.has(column.id)) problems.push(`Duplicate column id ${JSON.stringify(column.id)}.`);
    columnIds.add(column.id);
    for (const card of column.cards) {
      if (cardIds.has(card.id)) problems.push(`Duplicate card id ${JSON.stringify(card.id)}.`);
      cardIds.add(card.id);
    }
  }
  return problems;
}

/** Checks a card move against the rules without changing anything. */
export function canMoveCard<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  move: CardMove,
  rules: KanbanRules<Col> = {},
): { readonly ok: true; readonly noop: boolean } | BoardFailure {
  const source = findCard(columns, move.cardId);
  if (!source) return fail("card-not-found", `Card ${JSON.stringify(move.cardId)} does not exist.`);
  const target = findColumn(columns, move.toColumnId);
  if (!target) return fail("column-not-found", `Column ${JSON.stringify(move.toColumnId)} does not exist.`);

  const { card, column: from, index: fromIndex } = source;
  const to = target.column;
  const sameColumn = from.id === to.id;

  if (rules.isCardLocked?.(card, from)) return fail("locked", "This card is locked and cannot be moved.");

  const destinationCount = to.cards.length - (sameColumn ? 1 : 0);
  if (!Number.isInteger(move.toIndex) || move.toIndex < 0 || move.toIndex > destinationCount) {
    return fail("invalid-index", `Index ${move.toIndex} is out of range (0-${Math.max(0, destinationCount)}).`);
  }
  if (sameColumn && move.toIndex === fromIndex) return { ok: true, noop: true } as const;

  if (!sameColumn) {
    const allowedTargets = rules.transitions?.[String(from.id)];
    if (allowedTargets && !allowedTargets.includes(to.id)) {
      return fail("transition-not-allowed", "Cards cannot move from this column to that column.");
    }
    if (rules.acceptsCard) {
      const rejected = verdictToFailure(rules.acceptsCard(to, card, from), "This column does not accept that card.");
      if (rejected) return fail("not-accepted", rejected.message);
    }
    const limit = rules.maxCards?.(to);
    if (limit !== undefined && to.cards.length >= limit) {
      return fail("limit-reached", `This column is limited to ${limit} ${limit === 1 ? "card" : "cards"}.`);
    }
  }

  if (rules.canMoveCard) {
    const rejected = verdictToFailure(
      rules.canMoveCard({ card, from, to, fromIndex, toIndex: move.toIndex }),
      "This move is not allowed.",
    );
    if (rejected) return rejected;
  }
  return { ok: true, noop: false } as const;
}

/**
 * Moves a card and returns a new board. Inputs are never mutated; untouched columns keep their
 * identity; every other field of the card and of both columns is preserved. A move that would
 * not change anything is reported as `{ ok: false, reason: "no-op" }`.
 */
export function moveCard<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  move: CardMove,
  rules: KanbanRules<Col> = {},
): BoardResult<Col> {
  const verdict = canMoveCard(columns, move, rules);
  if (!verdict.ok) return verdict;
  if (verdict.noop) return fail("no-op", "The card is already there.");
  const source = findCard(columns, move.cardId);
  if (!source) return fail("card-not-found", `Card ${JSON.stringify(move.cardId)} does not exist.`);

  const from: CardLocation = { columnId: source.column.id, index: source.index };
  const to: CardLocation = { columnId: move.toColumnId, index: move.toIndex };

  const next = columns.map((column): Col => {
    if (column.id === source.column.id && column.id === move.toColumnId) {
      return { ...column, cards: arrayMove(column.cards, source.index, move.toIndex) };
    }
    if (column.id === source.column.id) {
      return { ...column, cards: arrayRemove(column.cards, source.index) };
    }
    if (column.id === move.toColumnId) {
      return { ...column, cards: arrayInsert(column.cards, move.toIndex, source.card) };
    }
    return column;
  });
  return { ok: true, columns: next, change: { type: "card", cardId: move.cardId, from, to } };
}

/** Checks a column reorder against the rules. */
export function canMoveColumn<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  move: ColumnMove,
  rules: KanbanRules<Col> = {},
): { readonly ok: true; readonly noop: boolean } | BoardFailure {
  const source = findColumn(columns, move.columnId);
  if (!source) return fail("column-not-found", `Column ${JSON.stringify(move.columnId)} does not exist.`);
  if (rules.isColumnLocked?.(source.column)) return fail("locked", "This column is locked and cannot be moved.");
  if (!Number.isInteger(move.toIndex) || move.toIndex < 0 || move.toIndex > columns.length - 1) {
    return fail("invalid-index", `Index ${move.toIndex} is out of range (0-${columns.length - 1}).`);
  }
  if (move.toIndex === source.index) return { ok: true, noop: true } as const;
  if (rules.canMoveColumn) {
    const rejected = verdictToFailure(
      rules.canMoveColumn({ column: source.column, fromIndex: source.index, toIndex: move.toIndex }),
      "This column cannot be moved there.",
    );
    if (rejected) return rejected;
  }
  return { ok: true, noop: false } as const;
}

/** Reorders columns, returning a new board. */
export function moveColumn<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  move: ColumnMove,
  rules: KanbanRules<Col> = {},
): BoardResult<Col> {
  const verdict = canMoveColumn(columns, move, rules);
  if (!verdict.ok) return verdict;
  if (verdict.noop) return fail("no-op", "The column is already there.");
  const source = findColumn(columns, move.columnId);
  if (!source) return fail("column-not-found", `Column ${JSON.stringify(move.columnId)} does not exist.`);
  return {
    ok: true,
    columns: arrayMove(columns, source.index, move.toIndex),
    change: { type: "column", columnId: move.columnId, from: source.index, to: move.toIndex },
  };
}

/** Ordering data: column ids mapped to their card ids. The shape APIs usually persist. */
export type BoardOrder = Readonly<Record<string, readonly UniqueId[]>>;

/** Exports the ordering of a board (`{ [columnId]: cardIds }`) plus the column order. */
export function getBoardOrder<Col extends KanbanColumnShape>(
  columns: readonly Col[],
): { readonly columnOrder: readonly UniqueId[]; readonly cards: BoardOrder } {
  const cards: Record<string, UniqueId[]> = {};
  for (const column of columns) cards[String(column.id)] = column.cards.map((c) => c.id);
  return { columnOrder: columns.map((c) => c.id), cards };
}

/**
 * Applies ordering data (e.g. the canonical order a server returned) to a board. Card and
 * column objects keep all their fields. The operation is forgiving on purpose: unknown ids in
 * `order` are ignored, and cards or columns the order does not mention stay where they are
 * (appended after the ordered ones), so no data can be lost by a stale or partial response.
 */
export function applyBoardOrder<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  order: { readonly columnOrder?: readonly UniqueId[]; readonly cards?: BoardOrder },
): readonly Col[] {
  const cardsById = new Map<UniqueId, CardOf<Col>>();
  const homeOf = new Map<UniqueId, UniqueId>();
  for (const column of columns) {
    for (const card of column.cards) {
      cardsById.set(card.id, card as CardOf<Col>);
      homeOf.set(card.id, column.id);
    }
  }
  const placed = new Set<UniqueId>();
  const rebuilt = columns.map((column): Col => {
    const ordered: CardOf<Col>[] = [];
    for (const id of order.cards?.[String(column.id)] ?? []) {
      const card = cardsById.get(id);
      if (card && !placed.has(id)) {
        placed.add(id);
        ordered.push(card);
      }
    }
    return { ...column, cards: ordered };
  });
  // Cards the order did not place stay in their original column, after the ordered ones.
  const withLeftovers = rebuilt.map((column): Col => {
    const leftovers = (columns.find((c) => c.id === column.id)?.cards ?? []).filter((c) => !placed.has(c.id));
    return leftovers.length > 0 ? { ...column, cards: [...column.cards, ...(leftovers as CardOf<Col>[])] } : column;
  });
  const wanted = order.columnOrder ?? columns.map((c) => c.id);
  const byId = new Map(withLeftovers.map((c) => [c.id, c] as const));
  const sorted: Col[] = [];
  const seen = new Set<UniqueId>();
  for (const id of wanted) {
    const column = byId.get(id);
    if (column && !seen.has(id)) {
      seen.add(id);
      sorted.push(column);
    }
  }
  for (const column of withLeftovers) if (!seen.has(column.id)) sorted.push(column);
  return sorted;
}
