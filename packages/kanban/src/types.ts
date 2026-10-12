import type { UniqueId } from "@gripflow/core";

/**
 * The board data format: an array of columns (their order is the column order), each holding
 * an ordered `cards` array. Everything else on columns and cards is yours.
 *
 * ```ts
 * interface Column { id: string; title: string; cards: Card[]; wipLimit?: number }
 * interface Card { id: string; title: string; assignee?: string }
 * ```
 */
export type KanbanColumnShape = {
  readonly id: UniqueId;
  readonly cards: readonly { readonly id: UniqueId }[];
};

/** The card type of a column type. */
export type CardOf<Col extends KanbanColumnShape> = Col["cards"][number];

export interface CardLocation {
  readonly columnId: UniqueId;
  readonly index: number;
}

/**
 * Place a card. `toIndex` is the position **in the destination column after the card has left its
 * old place** - the same convention as `arrayMove` and the sortable engine.
 */
export interface CardMove {
  readonly cardId: UniqueId;
  readonly toColumnId: UniqueId;
  readonly toIndex: number;
}

export interface ColumnMove {
  readonly columnId: UniqueId;
  readonly toIndex: number;
}

/** A change that was applied to the board. Handy for persistence payloads and undo entries. */
export type BoardChange =
  | {
      readonly type: "card";
      readonly cardId: UniqueId;
      readonly from: CardLocation;
      readonly to: CardLocation;
    }
  | {
      readonly type: "column";
      readonly columnId: UniqueId;
      readonly from: number;
      readonly to: number;
    };

export type BoardErrorCode =
  | "card-not-found"
  | "column-not-found"
  | "locked"
  | "not-accepted"
  | "limit-reached"
  | "transition-not-allowed"
  | "rejected"
  | "invalid-index"
  | "no-op";

export interface BoardFailure {
  readonly ok: false;
  readonly reason: BoardErrorCode;
  /** Human readable, safe to show in the UI or announce. */
  readonly message: string;
}

export type BoardResult<Col extends KanbanColumnShape> =
  | { readonly ok: true; readonly columns: readonly Col[]; readonly change: BoardChange }
  | BoardFailure;

export type RuleVerdict = boolean | { readonly ok: boolean; readonly reason?: string };

export interface CardMoveContext<Col extends KanbanColumnShape> {
  readonly card: CardOf<Col>;
  readonly from: Col;
  readonly to: Col;
  readonly fromIndex: number;
  readonly toIndex: number;
}

/** Restrictions enforced before any data is changed. All callbacks are optional. */
export interface KanbanRules<Col extends KanbanColumnShape> {
  /** Locked cards cannot be moved (neither reordered nor sent to another column). */
  isCardLocked?(card: CardOf<Col>, column: Col): boolean;
  /** Locked columns cannot be reordered. Their cards can still move. */
  isColumnLocked?(column: Col): boolean;
  /** Column-level restriction: does `to` take this card coming from `from`? */
  acceptsCard?(to: Col, card: CardOf<Col>, from: Col): RuleVerdict;
  /** Work-in-progress limit of a column. Only enforced when a card arrives from another column. */
  maxCards?(column: Col): number | undefined;
  /**
   * Allowed workflow transitions, keyed by source column id. A source without an entry may move
   * anywhere. Staying inside the same column is always allowed.
   */
  transitions?: Readonly<Record<string, readonly UniqueId[]>>;
  /** Final custom veto for card moves. */
  canMoveCard?(context: CardMoveContext<Col>): RuleVerdict;
  /** Final custom veto for column reordering. */
  canMoveColumn?(context: { column: Col; fromIndex: number; toIndex: number }): RuleVerdict;
}
