import type { UniqueId } from "@gripflow/core";

/**
 * Wire contracts shared by the browser and the API. They are plain JSON so any backend (NestJS,
 * Express, Fastify, serverless...) can use them. Gripflow never talks to your server by itself;
 * you send these payloads with your own HTTP client.
 */

/** Reorder one flat list. `toIndex` is the position after the item has left its old place. */
export interface ReorderRequest {
  readonly type: "reorder";
  readonly listId: string;
  readonly itemId: UniqueId;
  readonly toIndex: number;
  /** Optimistic-concurrency token returned by the previous response. */
  readonly expectedVersion?: string | number;
}

/** Move a Kanban card (within or between columns) or reorder columns. */
export interface CardMoveRequest {
  readonly type: "card";
  readonly cardId: UniqueId;
  /** Where the client believes the card is. A mismatch is reported as a conflict. */
  readonly fromColumnId: UniqueId;
  readonly toColumnId: UniqueId;
  readonly toIndex: number;
  readonly expectedVersion?: string | number;
}

export interface ColumnMoveRequest {
  readonly type: "column";
  readonly columnId: UniqueId;
  readonly toIndex: number;
  readonly expectedVersion?: string | number;
}

/** Re-parent / reorder a tree node. `parentId: null` is the root level. */
export interface TreeMoveRequest {
  readonly type: "tree";
  readonly nodeId: UniqueId;
  /** Where the client believes the node's parent is. `undefined` skips the check. */
  readonly fromParentId?: UniqueId | null;
  readonly toParentId: UniqueId | null;
  readonly toIndex: number;
  readonly expectedVersion?: string | number;
}

export type MoveRequest = ReorderRequest | CardMoveRequest | ColumnMoveRequest | TreeMoveRequest;

/** Canonical ordering of a flat list. */
export interface ListOrder {
  readonly order: readonly UniqueId[];
}

/** Canonical ordering of a board: column order plus the card ids of every column. */
export interface BoardOrderData {
  readonly columnOrder: readonly UniqueId[];
  readonly cards: Readonly<Record<string, readonly UniqueId[]>>;
}

/** Canonical ordering of a tree: root ids plus child ids per parent (leaves are omitted). */
export interface TreeOrderData {
  readonly roots: readonly UniqueId[];
  readonly children: Readonly<Record<string, readonly UniqueId[]>>;
}

/**
 * - `invalid-request`: payload failed validation (400)
 * - `not-found`: the item, column or parent does not exist (404)
 * - `forbidden`: the caller may not make this move (403)
 * - `conflict`: client state is stale, resync using the returned canonical order (409)
 * - `rule-violation`: the move breaks a business rule, e.g. WIP limit or hierarchy (422)
 * - `internal`: storage failed (500)
 */
export type MoveErrorCode =
  | "invalid-request"
  | "not-found"
  | "forbidden"
  | "conflict"
  | "rule-violation"
  | "internal";

export interface MoveSuccess<O> {
  readonly ok: true;
  /** What the server now holds. Apply it on the client instead of trusting the optimistic guess. */
  readonly order: O;
  readonly version?: string | number;
}

export interface MoveRejection<O> {
  readonly ok: false;
  readonly code: MoveErrorCode;
  /** Safe to show to the user. */
  readonly message: string;
  /** Finer-grained reason from the rule that rejected, e.g. `"limit-reached"`. */
  readonly detail?: string;
  /** Current canonical order when available, so the client can resync after a rejection. */
  readonly order?: O;
  readonly version?: string | number;
}

export type MoveResponse<O> = MoveSuccess<O> | MoveRejection<O>;

const STATUS: Readonly<Record<MoveErrorCode, number>> = {
  "invalid-request": 400,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "rule-violation": 422,
  internal: 500,
};

/** Suggested HTTP status for a rejection (200 for success). Your API is free to choose others. */
export function httpStatusFor(response: MoveResponse<unknown>): number {
  return response.ok ? 200 : STATUS[response.code];
}
