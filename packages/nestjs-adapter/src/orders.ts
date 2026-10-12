import type { UniqueId } from "@gripflow/core";
import { applyBoardOrder, getBoardOrder, type KanbanColumnShape } from "@gripflow/kanban";
import { type TreeNodeOf } from "@gripflow/tree";
import type { BoardOrderData, ListOrder, TreeOrderData } from "./contracts";

/** Exports the ordering of a flat list of items. */
export function getListOrder<T>(items: readonly T[], getId: (item: T) => UniqueId): ListOrder {
  return { order: items.map(getId) };
}

/**
 * Re-sorts `items` into the canonical `order`. Items missing from `order` keep their relative
 * position after the ordered ones and unknown ids are ignored, so a stale response can never
 * drop or duplicate an item. Items are returned by reference (their fields are untouched).
 */
export function applyListOrder<T>(
  items: readonly T[],
  order: ListOrder,
  getId: (item: T) => UniqueId,
): T[] {
  const byId = new Map<UniqueId, T>();
  for (const item of items) byId.set(getId(item), item);
  const placed = new Set<UniqueId>();
  const result: T[] = [];
  for (const id of order.order) {
    const item = byId.get(id);
    if (item !== undefined && !placed.has(id)) {
      placed.add(id);
      result.push(item);
    }
  }
  for (const item of items) if (!placed.has(getId(item))) result.push(item);
  return result;
}

/** Exports the ordering of a board in the wire format. */
export function getBoardOrderData<Col extends KanbanColumnShape>(columns: readonly Col[]): BoardOrderData {
  return getBoardOrder(columns);
}

/** Applies a canonical board order. Same forgiving behaviour as `applyBoardOrder`. */
export function applyBoardOrderData<Col extends KanbanColumnShape>(
  columns: readonly Col[],
  order: BoardOrderData,
): readonly Col[] {
  return applyBoardOrder(columns, order);
}

/** Exports the ordering of a tree in the wire format. */
export function getTreeOrder<N extends TreeNodeOf<N>>(tree: readonly N[]): TreeOrderData {
  const children: Record<string, UniqueId[]> = {};
  const visit = (nodes: readonly N[]): void => {
    for (const node of nodes) {
      const kids = node.children ?? [];
      if (kids.length > 0) {
        children[String(node.id)] = kids.map((kid) => kid.id);
        visit(kids);
      }
    }
  };
  visit(tree);
  return { roots: tree.map((node) => node.id), children };
}

interface Draft<N> {
  readonly node: N;
  readonly kids: Draft<N>[];
}

/**
 * Rebuilds `tree` according to a canonical order. Node fields are preserved. Ids that the order
 * does not know stay under their previous parent (or at the root when that parent is gone) and
 * unknown ids in `order` are ignored. A node can appear only once, which also makes a malformed
 * order (e.g. a cycle) harmless.
 */
export function applyTreeOrder<N extends TreeNodeOf<N>>(tree: readonly N[], order: TreeOrderData): N[] {
  const byId = new Map<UniqueId, N>();
  const originalParent = new Map<UniqueId, UniqueId | null>();
  const walk: UniqueId[] = [];
  const collect = (nodes: readonly N[], parentId: UniqueId | null): void => {
    for (const node of nodes) {
      byId.set(node.id, node);
      originalParent.set(node.id, parentId);
      walk.push(node.id);
      collect(node.children ?? [], node.id);
    }
  };
  collect(tree, null);

  const drafts = new Map<UniqueId, Draft<N>>();
  const place = (ids: readonly UniqueId[]): Draft<N>[] => {
    const out: Draft<N>[] = [];
    for (const id of ids) {
      const node = byId.get(id);
      if (node === undefined || drafts.has(id)) continue;
      const draft: Draft<N> = { node, kids: [] };
      drafts.set(id, draft);
      out.push(draft);
      draft.kids.push(...place(order.children[String(id)] ?? []));
    }
    return out;
  };
  const roots = place(order.roots);
  for (const id of walk) {
    if (drafts.has(id)) continue;
    const node = byId.get(id) as N;
    const draft: Draft<N> = { node, kids: [] };
    drafts.set(id, draft);
    const parent = originalParent.get(id);
    const parentDraft = parent === null || parent === undefined ? undefined : drafts.get(parent);
    (parentDraft ? parentDraft.kids : roots).push(draft);
  }

  const finalize = (draft: Draft<N>): N => {
    const hadChildrenKey = draft.node.children !== undefined;
    if (draft.kids.length === 0 && !hadChildrenKey) return draft.node;
    return { ...draft.node, children: draft.kids.map(finalize) };
  };
  return roots.map(finalize);
}
