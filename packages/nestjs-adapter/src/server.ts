import type { UniqueId } from "@gripflow/core";
import { arrayMove } from "@gripflow/core";
import {
  moveCard,
  moveColumn,
  type BoardFailure,
  type KanbanColumnShape,
  type KanbanRules,
} from "@gripflow/kanban";
import { moveNode, type TreeNodeOf, type TreeFailure, type TreeRules, getParentId } from "@gripflow/tree";
import type {
  BoardOrderData,
  CardMoveRequest,
  ColumnMoveRequest,
  ListOrder,
  MoveErrorCode,
  MoveRequest,
  MoveResponse,
  ReorderRequest,
  TreeMoveRequest,
  TreeOrderData,
} from "./contracts";
import { getBoardOrderData, getListOrder, getTreeOrder } from "./orders";
import { parseMoveRequest } from "./parse";

/** Outcome of applying one request to the current state. Pure: nothing is saved here. */
export type AppliedMove<S> =
  | { readonly ok: true; readonly state: S }
  | { readonly ok: false; readonly code: MoveErrorCode; readonly message: string; readonly detail?: string };

export type AuthorizeVerdict = boolean | { readonly ok: boolean; readonly reason?: string };

export interface MoveStore<S, Ctx> {
  /**
   * Loads the current state for the request. Ownership and tenancy checks that depend on the
   * caller belong here or in `authorize`. For concurrent writers, lock the row or use a
   * transaction between `load` and `save`; Gripflow cannot do that for you.
   */
  load(request: MoveRequest, ctx: Ctx): Promise<{ state: S; version?: string | number }>;
  /** Persists the new state. Throw to report failure; return the new version when you track one. */
  save(
    next: S,
    info: { request: MoveRequest; previous: S; version?: string | number; ctx: Ctx },
  ): Promise<{ version?: string | number } | void>;
}

export interface MoveHandlerOptions<S, O, Ctx, R extends MoveRequest> {
  store: MoveStore<S, Ctx>;
  /** Which request types this handler accepts. */
  accepts: (request: MoveRequest) => request is R;
  apply: (state: S, request: R) => AppliedMove<S>;
  toOrder: (state: S) => O;
  /**
   * Is this caller allowed to perform this move on this state? Runs *before* any rule or write,
   * with the current server-side state. The client's own checks are never trusted.
   */
  authorize?: (info: { request: R; state: S; ctx: Ctx }) => AuthorizeVerdict | Promise<AuthorizeVerdict>;
}

/** A framework-agnostic request handler: untrusted body in, typed response out. Never throws. */
export type MoveHandler<O, Ctx> = (body: unknown, ctx: Ctx) => Promise<MoveResponse<O>>;

/**
 * Orchestrates parse -> load -> authorize -> version check -> apply -> save -> canonical order.
 * Rejections always carry the current canonical order (when it could be loaded) so the client
 * can resync. Errors thrown by your `store`/`authorize` become an `internal` rejection and are
 * not leaked to the client.
 */
export function createMoveHandler<S, O, Ctx, R extends MoveRequest>(
  options: MoveHandlerOptions<S, O, Ctx, R>,
): MoveHandler<O, Ctx> {
  return async (body, ctx) => {
    const parsed = parseMoveRequest(body);
    if (!parsed.ok) return { ok: false, code: "invalid-request", message: parsed.message };
    const request = parsed.request;
    if (!options.accepts(request)) {
      return { ok: false, code: "invalid-request", message: `This endpoint does not handle "${request.type}" moves.` };
    }

    let loaded: { state: S; version?: string | number };
    try {
      loaded = await options.store.load(request, ctx);
    } catch {
      return { ok: false, code: "internal", message: "Could not load the current state." };
    }
    const { state, version } = loaded;
    const withVersion = version === undefined ? {} : { version };
    const rejection = (code: MoveErrorCode, message: string, detail?: string): MoveResponse<O> => ({
      ok: false,
      code,
      message,
      ...(detail === undefined ? {} : { detail }),
      order: options.toOrder(state),
      ...withVersion,
    });

    try {
      if (options.authorize) {
        const verdict = await options.authorize({ request, state, ctx });
        const allowed = typeof verdict === "boolean" ? verdict : verdict.ok;
        if (!allowed) {
          const reason = typeof verdict === "boolean" ? undefined : verdict.reason;
          return rejection("forbidden", reason ?? "You are not allowed to make this change.");
        }
      }
      if (
        request.expectedVersion !== undefined &&
        version !== undefined &&
        request.expectedVersion !== version
      ) {
        return rejection("conflict", "The data changed since you loaded it. It has been refreshed.", "stale-version");
      }
      const applied = options.apply(state, request);
      if (!applied.ok) return rejection(applied.code, applied.message, applied.detail);
      const saved = await options.store.save(applied.state, { request, previous: state, version, ctx });
      const nextVersion = saved && saved.version !== undefined ? saved.version : version;
      return {
        ok: true,
        order: options.toOrder(applied.state),
        ...(nextVersion === undefined ? {} : { version: nextVersion }),
      };
    } catch {
      return rejection("internal", "The change could not be saved.");
    }
  };
}

function boardFailure(failure: BoardFailure): AppliedMove<never> {
  const code: MoveErrorCode =
    failure.reason === "card-not-found" || failure.reason === "column-not-found"
      ? "not-found"
      : failure.reason === "invalid-index"
        ? "invalid-request"
        : "rule-violation";
  return { ok: false, code, message: failure.message, detail: failure.reason };
}

function treeFailure(failure: TreeFailure): AppliedMove<never> {
  const code: MoveErrorCode =
    failure.reason === "not-found" || failure.reason === "parent-not-found"
      ? "not-found"
      : failure.reason === "invalid-index"
        ? "invalid-request"
        : "rule-violation";
  return { ok: false, code, message: failure.message, detail: failure.reason };
}

/** Pure application of a flat-list reorder. Locating the item by id makes stale indexes harmless. */
export function applyReorderRequest(
  order: readonly UniqueId[],
  request: ReorderRequest,
): AppliedMove<readonly UniqueId[]> {
  const from = order.indexOf(request.itemId);
  if (from < 0) return { ok: false, code: "not-found", message: "That item no longer exists.", detail: "item-not-found" };
  if (request.toIndex > order.length - 1) {
    return { ok: false, code: "invalid-request", message: "The target position is out of range.", detail: "invalid-index" };
  }
  return { ok: true, state: arrayMove(order, from, request.toIndex) };
}

/** Pure application of a board move (card or column) with your {@link KanbanRules}. */
export function applyBoardRequest<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  request: CardMoveRequest | ColumnMoveRequest,
  rules: KanbanRules<Col> = {},
): AppliedMove<readonly Col[]> {
  if (request.type === "column") {
    const result = moveColumn(columns, { columnId: request.columnId, toIndex: request.toIndex }, rules);
    if (result.ok) return { ok: true, state: result.columns };
    return result.reason === "no-op" ? { ok: true, state: columns } : boardFailure(result);
  }
  const actualColumn = columns.find((c) => c.cards.some((card) => card.id === request.cardId));
  if (actualColumn && actualColumn.id !== request.fromColumnId) {
    return {
      ok: false,
      code: "conflict",
      message: "The card has already been moved. The board has been refreshed.",
      detail: "stale-location",
    };
  }
  const result = moveCard(
    columns,
    { cardId: request.cardId, toColumnId: request.toColumnId, toIndex: request.toIndex },
    rules,
  );
  if (result.ok) return { ok: true, state: result.columns };
  return result.reason === "no-op" ? { ok: true, state: columns } : boardFailure(result);
}

/** Pure application of a tree move with your {@link TreeRules}. */
export function applyTreeRequest<N extends TreeNodeOf<N>>(
  tree: readonly N[],
  request: TreeMoveRequest,
  rules: TreeRules<N> = {},
): AppliedMove<readonly N[]> {
  if (request.fromParentId !== undefined) {
    const actual = getParentId(tree, request.nodeId);
    if (actual !== undefined && actual !== request.fromParentId) {
      return {
        ok: false,
        code: "conflict",
        message: "The node has already been moved. The tree has been refreshed.",
        detail: "stale-location",
      };
    }
  }
  const result = moveNode(tree, { id: request.nodeId, parentId: request.toParentId, index: request.toIndex }, rules);
  if (result.ok) return { ok: true, state: result.tree };
  return result.reason === "no-op" ? { ok: true, state: tree } : treeFailure(result);
}

type Authorize<R extends MoveRequest, S, Ctx> = MoveHandlerOptions<S, unknown, Ctx, R>["authorize"];

export interface ListMoveHandlerOptions<Ctx> {
  store: MoveStore<readonly UniqueId[], Ctx>;
  authorize?: Authorize<ReorderRequest, readonly UniqueId[], Ctx>;
}

/** Handler for `type: "reorder"` requests. State is the ordered id list of one list. */
export function createListMoveHandler<Ctx = undefined>(
  options: ListMoveHandlerOptions<Ctx>,
): MoveHandler<ListOrder, Ctx> {
  return createMoveHandler<readonly UniqueId[], ListOrder, Ctx, ReorderRequest>({
    store: options.store,
    accepts: (r): r is ReorderRequest => r.type === "reorder",
    apply: applyReorderRequest,
    toOrder: (state) => getListOrder(state, (id) => id),
    authorize: options.authorize,
  });
}

export interface BoardMoveHandlerOptions<Col extends KanbanColumnShape, Ctx> {
  store: MoveStore<readonly Col[], Ctx>;
  rules?: KanbanRules<Col>;
  authorize?: Authorize<CardMoveRequest | ColumnMoveRequest, readonly Col[], Ctx>;
}

/** Handler for `type: "card"` and `type: "column"` requests. */
export function createBoardMoveHandler<Col extends KanbanColumnShape, Ctx = undefined>(
  options: BoardMoveHandlerOptions<Col, Ctx>,
): MoveHandler<BoardOrderData, Ctx> {
  return createMoveHandler<readonly Col[], BoardOrderData, Ctx, CardMoveRequest | ColumnMoveRequest>({
    store: options.store,
    accepts: (r): r is CardMoveRequest | ColumnMoveRequest => r.type === "card" || r.type === "column",
    apply: (state, request) => applyBoardRequest(state, request, options.rules),
    toOrder: getBoardOrderData,
    authorize: options.authorize,
  });
}

export interface TreeMoveHandlerOptions<N extends TreeNodeOf<N>, Ctx> {
  store: MoveStore<readonly N[], Ctx>;
  rules?: TreeRules<N>;
  authorize?: Authorize<TreeMoveRequest, readonly N[], Ctx>;
}

/** Handler for `type: "tree"` requests. */
export function createTreeMoveHandler<N extends TreeNodeOf<N>, Ctx = undefined>(
  options: TreeMoveHandlerOptions<N, Ctx>,
): MoveHandler<TreeOrderData, Ctx> {
  return createMoveHandler<readonly N[], TreeOrderData, Ctx, TreeMoveRequest>({
    store: options.store,
    accepts: (r): r is TreeMoveRequest => r.type === "tree",
    apply: (state, request) => applyTreeRequest(state, request, options.rules),
    toOrder: getTreeOrder,
    authorize: options.authorize,
  });
}
