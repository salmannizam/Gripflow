import type { UniqueId } from "@gripflow/core";
import type { FlatTreeNode, TreeEntry, TreeNodeOf } from "./types";

/** An index over a tree for O(1) lookups. Build it once per tree version with `indexTree`. */
export type TreeIndex<N> = ReadonlyMap<UniqueId, TreeEntry<N>>;

/**
 * Builds a lookup of every node. Insertion order of the map is depth-first pre-order.
 * Throws if two nodes share an id, because every operation relies on ids being unique.
 */
export function indexTree<N extends TreeNodeOf<N>>(nodes: readonly N[]): TreeIndex<N> {
  const index = new Map<UniqueId, TreeEntry<N>>();
  const visit = (list: readonly N[], parentId: UniqueId | null, depth: number): void => {
    list.forEach((node, position) => {
      if (index.has(node.id)) {
        throw new Error(
          `[gripflow/tree] Duplicate node id ${JSON.stringify(node.id)}. Node ids must be unique across the whole tree.`,
        );
      }
      index.set(node.id, { node, parentId, index: position, depth, siblingCount: list.length });
      if (node.children && node.children.length > 0) visit(node.children, node.id, depth + 1);
    });
  };
  visit(nodes, null, 0);
  return index;
}

/** Depth-first pre-order traversal. Return `false` from `visit` to stop early. */
export function walkTree<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  visit: (entry: TreeEntry<N>) => boolean | void,
): void {
  const walk = (list: readonly N[], parentId: UniqueId | null, depth: number): boolean => {
    for (let position = 0; position < list.length; position++) {
      const node = list[position] as N;
      const result = visit({ node, parentId, index: position, depth, siblingCount: list.length });
      if (result === false) return false;
      if (node.children && node.children.length > 0 && !walk(node.children, node.id, depth + 1)) {
        return false;
      }
    }
    return true;
  };
  walk(nodes, null, 0);
}

/** Locates a node. Returns `null` if the id does not exist. */
export function findNode<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  id: UniqueId,
): TreeEntry<N> | null {
  let found: TreeEntry<N> | null = null;
  walkTree(nodes, (entry) => {
    if (entry.node.id === id) {
      found = entry;
      return false;
    }
    return undefined;
  });
  return found;
}

/** Id of the parent, `null` for root nodes, `undefined` for unknown ids. */
export function getParentId<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  id: UniqueId,
): UniqueId | null | undefined {
  const entry = findNode(nodes, id);
  return entry ? entry.parentId : undefined;
}

/** Ancestor ids ordered from the root down to the direct parent. Empty for root nodes. */
export function getAncestorIds<N>(index: TreeIndex<N>, id: UniqueId): UniqueId[] {
  const ancestors: UniqueId[] = [];
  let current = index.get(id)?.parentId ?? null;
  while (current !== null) {
    ancestors.unshift(current);
    current = index.get(current)?.parentId ?? null;
  }
  return ancestors;
}

/** Every descendant id in depth-first pre-order (excluding the node itself). */
export function getDescendantIds<N extends TreeNodeOf<N>>(node: N): UniqueId[] {
  const ids: UniqueId[] = [];
  const visit = (children: readonly N[] | undefined): void => {
    if (!children) return;
    for (const child of children) {
      ids.push(child.id);
      visit(child.children);
    }
  };
  visit(node.children);
  return ids;
}

/** `true` when `id` is somewhere below `ancestorId`. A node is not its own descendant. */
export function isDescendantOf<N>(index: TreeIndex<N>, id: UniqueId, ancestorId: UniqueId): boolean {
  let current = index.get(id)?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = index.get(current)?.parentId ?? null;
  }
  return false;
}

/** Number of levels below `node` (`0` for a leaf). */
export function getSubtreeHeight<N extends TreeNodeOf<N>>(node: N): number {
  let height = 0;
  const visit = (children: readonly N[] | undefined, level: number): void => {
    if (!children || children.length === 0) return;
    height = Math.max(height, level);
    for (const child of children) visit(child.children, level + 1);
  };
  visit(node.children, 1);
  return height;
}

export function countNodes<N extends TreeNodeOf<N>>(nodes: readonly N[]): number {
  let count = 0;
  walkTree(nodes, () => {
    count++;
  });
  return count;
}

export interface FlattenOptions {
  /**
   * Which nodes are expanded. A set of ids, or `"all"` (default). Children of collapsed nodes
   * are not part of the result.
   */
  expandedIds?: ReadonlySet<UniqueId> | "all";
  /**
   * Restrict the result to these ids (search/filter integration). Nodes outside the set are
   * skipped, together with their subtree. Use `filterTree` to compute a set that keeps ancestors.
   */
  visibleIds?: ReadonlySet<UniqueId>;
}

/** Flattens the *visible* part of a tree into rows, ready to render as a list. */
export function flattenTree<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  options: FlattenOptions = {},
): FlatTreeNode<N>[] {
  const { expandedIds = "all", visibleIds } = options;
  const rows: FlatTreeNode<N>[] = [];
  const seen = new Set<UniqueId>();
  const visit = (
    list: readonly N[],
    parentId: UniqueId | null,
    depth: number,
    path: readonly UniqueId[],
  ): void => {
    list.forEach((node, position) => {
      if (seen.has(node.id)) {
        throw new Error(`[gripflow/tree] Duplicate node id ${JSON.stringify(node.id)}.`);
      }
      seen.add(node.id);
      if (visibleIds && !visibleIds.has(node.id)) return;
      const hasChildren = !!node.children && node.children.length > 0;
      const expanded = hasChildren && (expandedIds === "all" || expandedIds.has(node.id));
      const nodePath = [...path, node.id];
      rows.push({
        id: node.id,
        node,
        parentId,
        index: position,
        depth,
        siblingCount: list.length,
        hasChildren,
        expanded,
        path: nodePath,
        posInSet: position + 1,
        setSize: list.length,
      });
      if (expanded && node.children) visit(node.children, node.id, depth + 1, nodePath);
    });
  };
  visit(nodes, null, 0, []);
  return rows;
}

export interface FilterResult {
  /** Nodes that satisfy the predicate. */
  readonly matchedIds: ReadonlySet<UniqueId>;
  /** Matches plus their ancestors (and optionally their descendants). Pass to `flattenTree`. */
  readonly visibleIds: ReadonlySet<UniqueId>;
  /** Ancestors of matches: expand these to reveal every match. */
  readonly ancestorIds: ReadonlySet<UniqueId>;
}

/**
 * Search/filter support. Computes which ids to show so that every match stays reachable in its
 * hierarchy. The tree itself is not changed, so ids and moves keep working on the full data.
 */
export function filterTree<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  predicate: (node: N) => boolean,
  options: { includeDescendants?: boolean } = {},
): FilterResult {
  const index = indexTree(nodes);
  const matched = new Set<UniqueId>();
  const visible = new Set<UniqueId>();
  const ancestors = new Set<UniqueId>();
  for (const [id, entry] of index) {
    if (!predicate(entry.node)) continue;
    matched.add(id);
    visible.add(id);
    for (const ancestor of getAncestorIds(index, id)) {
      visible.add(ancestor);
      ancestors.add(ancestor);
    }
    if (options.includeDescendants) {
      for (const descendant of getDescendantIds(entry.node)) visible.add(descendant);
    }
  }
  return { matchedIds: matched, visibleIds: visible, ancestorIds: ancestors };
}

/** Immutable helper: returns a new tree where the node with `id` is replaced by `update(node)`. */
export function updateNode<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  id: UniqueId,
  update: (node: N) => N,
): readonly N[] {
  let changed = false;
  const visit = (list: readonly N[]): readonly N[] => {
    let next: N[] | null = null;
    list.forEach((node, position) => {
      let replacement = node;
      if (node.id === id) {
        replacement = update(node);
      } else if (node.children && node.children.length > 0) {
        const children = visit(node.children);
        if (children !== node.children) replacement = { ...node, children };
      }
      if (replacement !== node) {
        changed = true;
        next ??= list.slice();
        next[position] = replacement;
      }
    });
    return next ?? list;
  };
  const result = visit(nodes);
  return changed ? result : nodes;
}

/** Immutable removal. Returns the same array when the id is unknown. */
export function removeNode<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  id: UniqueId,
): { readonly tree: readonly N[]; readonly removed: N | null } {
  let removed: N | null = null;
  const visit = (list: readonly N[]): readonly N[] => {
    const position = list.findIndex((node) => node.id === id);
    if (position >= 0) {
      removed = list[position] as N;
      return [...list.slice(0, position), ...list.slice(position + 1)];
    }
    let next: N[] | null = null;
    list.forEach((node, i) => {
      if (!node.children || node.children.length === 0 || removed) return;
      const children = visit(node.children);
      if (children !== node.children) {
        next ??= list.slice();
        next[i] = { ...node, children };
      }
    });
    return next ?? list;
  };
  const tree = visit(nodes);
  return { tree, removed };
}

/** Immutable insertion of `node` into `parentId` (`null` = root) at `index`. */
export function insertNode<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
  parentId: UniqueId | null,
  index: number,
  node: N,
): readonly N[] {
  const insert = (list: readonly N[]): N[] => [...list.slice(0, index), node, ...list.slice(index)];
  if (parentId === null) return insert(nodes);
  return updateNode(nodes, parentId, (parent) => ({ ...parent, children: insert(parent.children ?? []) }));
}

/**
 * Converts a flat list with parent references (typical for SQL tables) into the nested format.
 * The input order defines sibling order. Items whose parent is missing become roots.
 * Throws on duplicate ids or cycles.
 */
export function buildTree<T extends { readonly id: UniqueId }>(
  items: readonly T[],
  getParentId: (item: T) => UniqueId | null | undefined,
): TreeOf<T>[] {
  const nodes = new Map<UniqueId, TreeOf<T>>();
  for (const item of items) {
    if (nodes.has(item.id)) {
      throw new Error(`[gripflow/tree] Duplicate id ${JSON.stringify(item.id)} in flat list.`);
    }
    nodes.set(item.id, { ...item, children: [] });
  }
  const roots: TreeOf<T>[] = [];
  for (const item of items) {
    const node = nodes.get(item.id) as TreeOf<T>;
    const parentId = getParentId(item);
    const parent = parentId === null || parentId === undefined ? undefined : nodes.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const reachable = new Set<UniqueId>();
  const visit = (list: readonly TreeOf<T>[]): void => {
    for (const node of list) {
      reachable.add(node.id);
      visit(node.children);
    }
  };
  visit(roots);
  if (reachable.size !== nodes.size) {
    throw new Error("[gripflow/tree] The parent references contain a cycle.");
  }
  return roots;
}

/** Item type produced by `buildTree`: the original fields plus a `children` array. */
export type TreeOf<T extends { readonly id: UniqueId }> = T & { children: TreeOf<T>[] };

/** Inverse of `buildTree`: a depth-first flat list where every item records its parent. */
export function toParentList<N extends TreeNodeOf<N>>(
  nodes: readonly N[],
): Array<Omit<N, "children"> & { parentId: UniqueId | null; index: number }> {
  const list: Array<Omit<N, "children"> & { parentId: UniqueId | null; index: number }> = [];
  walkTree(nodes, ({ node, parentId, index }) => {
    const { children: _children, ...rest } = node;
    list.push({ ...rest, parentId, index });
  });
  return list;
}
