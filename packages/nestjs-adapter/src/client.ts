import type { SortableMove } from "@gripflow/core";
import type { BoardChange, KanbanColumnShape } from "@gripflow/kanban";
import type { AppliedTreeMove } from "@gripflow/tree";
import type {
  BoardOrderData,
  CardMoveRequest,
  ColumnMoveRequest,
  MoveErrorCode,
  MoveRejection,
  MoveResponse,
  MoveSuccess,
  ReorderRequest,
  TreeMoveRequest,
} from "./contracts";
import { applyBoardOrderData } from "./orders";

/** Thrown by {@link unwrapMoveResponse}; carries the server's verdict and canonical order. */
export class MoveRejectedError<O = unknown> extends Error {
  readonly code: MoveErrorCode;
  readonly detail: string | undefined;
  /** The server's current canonical order, to resync the UI after rollback. */
  readonly order: O | undefined;
  readonly version: string | number | undefined;

  constructor(rejection: MoveRejection<O>) {
    super(rejection.message);
    this.name = "MoveRejectedError";
    this.code = rejection.code;
    this.detail = rejection.detail;
    this.order = rejection.order;
    this.version = rejection.version;
  }
}

/** Returns the success, or throws {@link MoveRejectedError}. Use inside a `persist` callback. */
export function unwrapMoveResponse<O>(response: MoveResponse<O>): MoveSuccess<O> {
  if (response.ok) return response;
  throw new MoveRejectedError(response);
}

/** Maps a Kanban `BoardChange` to the wire request. */
export function boardChangeToRequest(
  change: BoardChange,
  expectedVersion?: string | number,
): CardMoveRequest | ColumnMoveRequest {
  const version = expectedVersion === undefined ? {} : { expectedVersion };
  if (change.type === "column") {
    return { type: "column", columnId: change.columnId, toIndex: change.to, ...version };
  }
  return {
    type: "card",
    cardId: change.cardId,
    fromColumnId: change.from.columnId,
    toColumnId: change.to.columnId,
    toIndex: change.to.index,
    ...version,
  };
}

/** Maps a sortable-list move to the wire request. */
export function sortableMoveToRequest(
  listId: string,
  move: SortableMove,
  expectedVersion?: string | number,
): ReorderRequest {
  return {
    type: "reorder",
    listId,
    itemId: move.activeId,
    toIndex: move.toIndex,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

/** Maps an applied tree move (`moveNode(...).move`) to the wire request. */
export function treeMoveToRequest(
  move: AppliedTreeMove,
  expectedVersion?: string | number,
): TreeMoveRequest {
  return {
    type: "tree",
    nodeId: move.id,
    fromParentId: move.from.parentId,
    toParentId: move.to.parentId,
    toIndex: move.to.index,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

export interface BoardPersisterOptions {
  /** Return the latest known version for optimistic concurrency, if your API tracks one. */
  getVersion?: () => string | number | undefined;
  /** Called with every successful response, e.g. to remember `response.version`. */
  onResponse?: (response: MoveSuccess<BoardOrderData>) => void;
}

/**
 * Builds the `persist` option for `useOptimisticBoard` from your own `send` function (which does
 * the HTTP call). On success the server's canonical order is applied to the board; on rejection a
 * {@link MoveRejectedError} is thrown, which makes the hook roll back. Catch it in `onRejected`
 * to resync with `error.order`.
 */
export function createBoardPersister<Col extends KanbanColumnShape>(
  send: (request: CardMoveRequest | ColumnMoveRequest) => Promise<MoveResponse<BoardOrderData>>,
  options: BoardPersisterOptions = {},
): (args: { columns: readonly Col[]; change: BoardChange }) => Promise<readonly Col[]> {
  return async ({ columns, change }) => {
    const request = boardChangeToRequest(change, options.getVersion?.());
    const success = unwrapMoveResponse(await send(request));
    options.onResponse?.(success);
    return applyBoardOrderData(columns, success.order);
  };
}

/** Type guard for errors produced by this package. */
export function isMoveRejectedError(error: unknown): error is MoveRejectedError {
  return error instanceof MoveRejectedError;
}
