import type { UniqueId } from "@gripflow/core";

/**
 * The tree data format: a nested array where every node has a unique `id` and optional
 * `children`. Consumers keep their own fields on the node (`name`, `locked`, ...); they are
 * never touched, only re-parented.
 *
 * ```ts
 * interface FileNode { id: string; name: string; children?: FileNode[]; locked?: boolean }
 * ```
 *
 * `N` is the consumer's own node type. It only has to satisfy this recursive constraint.
 */
export type TreeNodeOf<N> = {
  readonly id: UniqueId;
  readonly children?: readonly N[];
};

/** Position of a node among its siblings. `parentId: null` means the root level. */
export interface TreePlacement {
  readonly parentId: UniqueId | null;
  readonly index: number;
}

/** Everything known about a node after indexing the tree. */
export interface TreeEntry<N> extends TreePlacement {
  readonly node: N;
  /** Root nodes have depth `0`. */
  readonly depth: number;
  /** Number of children of the parent (or of the root list). */
  readonly siblingCount: number;
}

/** One visible row of a flattened tree. */
export interface FlatTreeNode<N> extends TreeEntry<N> {
  readonly id: UniqueId;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** Ids from the root down to (and including) this node. */
  readonly path: readonly UniqueId[];
  /** 1-based position among siblings, for `aria-posinset`. */
  readonly posInSet: number;
  /** Sibling count, for `aria-setsize`. */
  readonly setSize: number;
}

/**
 * A request to place a node. `index` is the position **among the destination's children after
 * the node has been removed from its old place** - the same convention as `arrayMove`.
 */
export interface TreeMove extends TreePlacement {
  readonly id: UniqueId;
}

export type TreeMoveErrorCode =
  | "not-found"
  | "parent-not-found"
  | "into-self"
  | "into-descendant"
  | "locked"
  | "parent-rejected"
  | "max-depth"
  | "rejected"
  | "invalid-index"
  | "no-op";

/** A move that was applied. `to.index` is the final index of the node in its new parent. */
export interface AppliedTreeMove {
  readonly id: UniqueId;
  readonly from: TreePlacement;
  readonly to: TreePlacement;
}

export type TreeMoveResult<N> =
  | { readonly ok: true; readonly tree: readonly N[]; readonly move: AppliedTreeMove }
  | {
      readonly ok: false;
      readonly reason: TreeMoveErrorCode;
      /** Human readable explanation, safe to show in the UI or an announcement. */
      readonly message: string;
    };

export interface TreeMoveContext<N> {
  readonly node: N;
  readonly parent: N | null;
  readonly from: TreePlacement;
  readonly to: TreePlacement;
}

/** Hierarchy rules enforced by `canMoveNode` / `moveNode` before any data is changed. */
export interface TreeRules<N> {
  /**
   * Deepest level a node may end up on (root level is `0`). The height of the moved subtree is
   * included, so a node with grandchildren needs two spare levels.
   */
  maxDepth?: number;
  /** Locked nodes cannot be moved. They can still receive children unless `acceptsChildren` says no. */
  isLocked?(node: N): boolean;
  /** Return `false` for leaf-only nodes (files). Default: every node accepts children. */
  acceptsChildren?(node: N): boolean;
  /** Final custom veto, e.g. "a folder may only contain documents". */
  canMove?(context: TreeMoveContext<N>): boolean | { readonly ok: boolean; readonly reason?: string };
}

/** Where, relative to the row under the pointer, the dragged node would land. */
export type DropPosition = "before" | "after" | "inside";

/** Result of `moveNode`/`canMoveNode` failing; shared by helpers. */
export interface TreeFailure {
  readonly ok: false;
  readonly reason: TreeMoveErrorCode;
  readonly message: string;
}
