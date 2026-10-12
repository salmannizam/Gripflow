import type { UniqueId } from "@gripflow/core";
import type {
  AppliedTreeMove,
  DropPosition,
  TreeFailure,
  TreeMove,
  TreeMoveResult,
  TreeNodeOf,
  TreeRules,
} from "./types";
import {
  getSubtreeHeight,
  indexTree,
  insertNode,
  isDescendantOf,
  removeNode,
  type TreeIndex,
} from "./utils";

function fail(reason: TreeFailure["reason"], message: string): TreeFailure {
  return { ok: false, reason, message };
}

/**
 * Checks a move against the hierarchy rules without changing anything. Never throws for bad
 * *requests* (unknown ids, cycles, ...); they come back as `{ ok: false, reason }`.
 * Throws only if the tree itself is invalid (duplicate ids).
 */
export function canMoveNode<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  move: TreeMove,
  rules: TreeRules<N> = {},
  index: TreeIndex<N> = indexTree(nodes),
): { readonly ok: true } | TreeFailure {
  const entry = index.get(move.id);
  if (!entry) return fail("not-found", `Node ${JSON.stringify(move.id)} does not exist.`);
  const { node } = entry;

  if (rules.isLocked?.(node)) return fail("locked", "This item is locked and cannot be moved.");

  let parent: N | null = null;
  if (move.parentId !== null) {
    if (move.parentId === move.id) return fail("into-self", "An item cannot be moved into itself.");
    const parentEntry = index.get(move.parentId);
    if (!parentEntry) {
      return fail("parent-not-found", `Target ${JSON.stringify(move.parentId)} does not exist.`);
    }
    if (isDescendantOf(index, move.parentId, move.id)) {
      return fail("into-descendant", "An item cannot be moved into one of its own descendants.");
    }
    parent = parentEntry.node;
    if (rules.acceptsChildren && !rules.acceptsChildren(parent)) {
      return fail("parent-rejected", "This item cannot contain other items.");
    }
  }

  // Children of the destination once the node has left its old place.
  const sameParent = entry.parentId === move.parentId;
  const destinationCount =
    (parent ? (parent.children?.length ?? 0) : nodes.length) - (sameParent ? 1 : 0);
  if (!Number.isInteger(move.index) || move.index < 0 || move.index > destinationCount) {
    return fail(
      "invalid-index",
      `Index ${move.index} is out of range (0-${Math.max(0, destinationCount)}).`,
    );
  }

  if (sameParent && move.index === entry.index) return fail("no-op", "The item is already there.");

  if (rules.maxDepth !== undefined) {
    const newDepth = move.parentId === null ? 0 : (index.get(move.parentId)?.depth ?? 0) + 1;
    if (newDepth + getSubtreeHeight(node) > rules.maxDepth) {
      return fail("max-depth", `Nesting is limited to ${rules.maxDepth + 1} levels.`);
    }
  }

  if (rules.canMove) {
    const verdict = rules.canMove({
      node,
      parent,
      from: { parentId: entry.parentId, index: entry.index },
      to: { parentId: move.parentId, index: move.index },
    });
    const ok = typeof verdict === "boolean" ? verdict : verdict.ok;
    if (!ok) {
      const reason = typeof verdict === "boolean" ? undefined : verdict.reason;
      return fail("rejected", reason ?? "This move is not allowed.");
    }
  }

  return { ok: true };
}

/**
 * Moves a node (with its whole subtree) and returns a *new* tree. The input is never mutated,
 * untouched branches keep their object identity, and every other field of the moved node is
 * preserved. Invalid moves are rejected before anything is built.
 */
export function moveNode<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  move: TreeMove,
  rules: TreeRules<N> = {},
): TreeMoveResult<N> {
  const index = indexTree(nodes);
  const verdict = canMoveNode(nodes, move, rules, index);
  if (!verdict.ok) return verdict;
  const entry = index.get(move.id);
  if (!entry) return fail("not-found", `Node ${JSON.stringify(move.id)} does not exist.`);

  const { tree: without, removed } = removeNode(nodes, move.id);
  if (!removed) return fail("not-found", `Node ${JSON.stringify(move.id)} does not exist.`);
  const tree = insertNode(without, move.parentId, move.index, removed);
  const applied: AppliedTreeMove = {
    id: move.id,
    from: { parentId: entry.parentId, index: entry.index },
    to: { parentId: move.parentId, index: move.index },
  };
  return { ok: true, tree, move: applied };
}

export interface ResolveDropInput {
  readonly activeId: UniqueId;
  readonly overId: UniqueId;
  readonly position: DropPosition;
  /**
   * With `"after"` on an *expanded* node that shows children, the natural landing spot is the
   * first child, not below the whole subtree. Pass the expanded ids (or `"all"`) to get that.
   */
  readonly expandedIds?: ReadonlySet<UniqueId> | "all";
}

/**
 * Turns a drop intent ("above/below/inside the row under the pointer") into a `TreeMove`.
 * The result is not validated: feed it to `canMoveNode`/`moveNode`.
 * Returns `null` for unknown ids or when dropping a node on itself.
 */
export function resolveTreeDrop<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  input: ResolveDropInput,
  index: TreeIndex<N> = indexTree(nodes),
): TreeMove | null {
  const active = index.get(input.activeId);
  const over = index.get(input.overId);
  if (!active || !over || input.activeId === input.overId) return null;

  const childCount = over.node.children?.length ?? 0;
  const isExpanded =
    childCount > 0 &&
    (input.expandedIds === "all" || (input.expandedIds?.has(over.node.id) ?? false));

  if (input.position === "inside") {
    const count = childCount - (active.parentId === over.node.id ? 1 : 0);
    return { id: input.activeId, parentId: over.node.id, index: count };
  }
  if (input.position === "after" && isExpanded) {
    return { id: input.activeId, parentId: over.node.id, index: 0 };
  }

  let position = over.index + (input.position === "after" ? 1 : 0);
  if (active.parentId === over.parentId && active.index < position) position -= 1;
  return { id: input.activeId, parentId: over.parentId, index: position };
}

type Direction = "up" | "down" | "indent" | "outdent";

/** Keyboard-friendly single steps: the building blocks of the Alt+Arrow fallback. */
export function stepMove<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  id: UniqueId,
  direction: Direction,
  rules: TreeRules<N> = {},
): TreeMoveResult<N> {
  const index = indexTree(nodes);
  const entry = index.get(id);
  if (!entry) return fail("not-found", `Node ${JSON.stringify(id)} does not exist.`);

  const siblings = (parentId: UniqueId | null): readonly N[] =>
    parentId === null ? nodes : (index.get(parentId)?.node.children ?? []);

  let move: TreeMove;
  switch (direction) {
    case "up":
      if (entry.index === 0) return fail("no-op", "Already the first item.");
      move = { id, parentId: entry.parentId, index: entry.index - 1 };
      break;
    case "down":
      if (entry.index >= siblings(entry.parentId).length - 1) {
        return fail("no-op", "Already the last item.");
      }
      move = { id, parentId: entry.parentId, index: entry.index + 1 };
      break;
    case "indent": {
      const previous = siblings(entry.parentId)[entry.index - 1];
      if (!previous) return fail("no-op", "There is no previous item to nest under.");
      move = { id, parentId: previous.id, index: previous.children?.length ?? 0 };
      break;
    }
    case "outdent": {
      if (entry.parentId === null) return fail("no-op", "Already at the top level.");
      const parent = index.get(entry.parentId);
      if (!parent) return fail("not-found", "Parent not found.");
      move = { id, parentId: parent.parentId, index: parent.index + 1 };
      break;
    }
  }
  return moveNode(nodes, move, rules);
}

/** Convenience wrappers around `stepMove`. */
export const moveUp = <N extends TreeNodeOf<N>>(nodes: readonly N[], id: UniqueId, rules?: TreeRules<N>) =>
  stepMove(nodes, id, "up", rules);
export const moveDown = <N extends TreeNodeOf<N>>(nodes: readonly N[], id: UniqueId, rules?: TreeRules<N>) =>
  stepMove(nodes, id, "down", rules);
export const indentNode = <N extends TreeNodeOf<N>>(nodes: readonly N[], id: UniqueId, rules?: TreeRules<N>) =>
  stepMove(nodes, id, "indent", rules);
export const outdentNode = <N extends TreeNodeOf<N>>(nodes: readonly N[], id: UniqueId, rules?: TreeRules<N>) =>
  stepMove(nodes, id, "outdent", rules);

/**
 * Splits the pointer's vertical position inside a row into a drop position:
 * top quarter = before, bottom quarter = after, the middle half = inside. Rows that cannot
 * contain children (`allowInside: false`) split in two halves instead.
 */
export function getDropPosition(
  rect: { readonly top: number; readonly height: number },
  pointerY: number,
  allowInside = true,
): DropPosition {
  const ratio = rect.height > 0 ? (pointerY - rect.top) / rect.height : 0.5;
  if (!allowInside) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}
