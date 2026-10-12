import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  keyboardSensor,
  pointerSensor,
  type ActiveInfo,
  type DragEndEvent,
  type DragEngine,
  type Sensor,
  type UniqueId,
} from "@gripflow/core";
import {
  DragDropProvider,
  useControllableState,
  useDragDropContext,
  useDragEngine,
  useDraggable,
  useDroppable,
  useIsomorphicLayoutEffect,
  useStoreSelector,
  type DragDropProviderProps,
} from "@gripflow/react";
import { canMoveNode, getDropPosition, moveNode, resolveTreeDrop, stepMove } from "../move";
import type {
  AppliedTreeMove,
  DropPosition,
  FlatTreeNode,
  TreeMove,
  TreeMoveErrorCode,
  TreeNodeOf,
  TreeRules,
} from "../types";
import { flattenTree, indexTree, type TreeIndex } from "../utils";

/** What the engine knows about a would-be drop on a given row. */
export interface TreeDropIntent {
  readonly position: DropPosition;
  /** The move that would be applied; `null` when it cannot be expressed (e.g. over itself). */
  readonly move: TreeMove | null;
  /** The move is allowed (or would not change anything). */
  readonly valid: boolean;
  /** The drop would leave the tree exactly as it is. */
  readonly unchanged: boolean;
  readonly code: TreeMoveErrorCode | null;
  /** Human readable reason when `valid` is `false`. */
  readonly reason: string | null;
}

export interface TreeMoveFailure {
  readonly reason: TreeMoveErrorCode;
  readonly message: string;
}

export interface TreeDndProps<N extends TreeNodeOf<N>>
  extends Omit<DragDropProviderProps, "children" | "sensors"> {
  /** The tree. You own it: `onChange` hands you the next version, nothing is mutated. */
  nodes: readonly N[];
  /** Called with the new tree after an accepted drop or keyboard move. */
  onChange?: (nodes: readonly N[], move: AppliedTreeMove) => void;
  /** Hierarchy rules: max depth, locked nodes, which nodes accept children, custom checks. */
  rules?: TreeRules<N>;
  /** Controlled expansion state. */
  expandedIds?: ReadonlySet<UniqueId>;
  /** Initial expansion for uncontrolled use. Default: everything expanded. */
  defaultExpandedIds?: ReadonlySet<UniqueId> | "all";
  onExpandedChange?: (expandedIds: ReadonlySet<UniqueId>) => void;
  /** Search/filter integration: only these ids are rendered (see `filterTree`). */
  visibleIds?: ReadonlySet<UniqueId>;
  /** Spoken name of a node. Default: `label`, `name` or `title` field, else the id. */
  getLabel?: (node: N) => string;
  /** A drop or keyboard move was refused by the rules. */
  onMoveRejected?: (failure: TreeMoveFailure, move: TreeMove | null) => void;
  /** Override the input sensors. Default: pointer plus keyboard (Space picks up). */
  sensors?: readonly Sensor[];
  children?: ReactNode;
}

export interface TreeApi<N extends TreeNodeOf<N>> {
  readonly nodes: readonly N[];
  /** The visible rows, in render order. */
  readonly rows: readonly FlatTreeNode<N>[];
  readonly index: TreeIndex<N>;
  readonly expandedIds: ReadonlySet<UniqueId>;
  isExpanded(id: UniqueId): boolean;
  toggle(id: UniqueId): void;
  expand(id: UniqueId): void;
  collapse(id: UniqueId): void;
  expandAll(): void;
  collapseAll(): void;
  getNode(id: UniqueId): N | undefined;
  /** Reorder/indent without dragging; the same action the Alt+Arrow keys run. */
  step(id: UniqueId, direction: "up" | "down" | "indent" | "outdent"): boolean;
  /** Spread on the element wrapping the rows. */
  readonly treeProps: { readonly role: "tree" };
}

interface TreeInternals<N extends TreeNodeOf<N>> extends TreeApi<N> {
  readonly engine: DragEngine;
  readonly focusedId: UniqueId | undefined;
  readonly setFocusedId: (id: UniqueId) => void;
  readonly labelOf: (id: UniqueId) => string;
  readonly rules: TreeRules<N>;
  describe(activeId: UniqueId, overId: UniqueId, activator: string, pointerY: number): TreeDropIntent | null;
  focusRow(id: UniqueId | undefined): void;
}

interface Bridge {
  describe(activeId: UniqueId, overId: UniqueId, activator: string, pointerY: number): TreeDropIntent | null;
  commit(event: DragEndEvent): void;
  labelOf(id: UniqueId): string;
  pointerY(): number;
}

const TreeContext = createContext<TreeInternals<never> | null>(null);

function useTreeInternals<N extends TreeNodeOf<N>>(hookName: string): TreeInternals<N> {
  const value = useContext(TreeContext);
  if (!value) {
    throw new Error(
      `[gripflow/tree] ${hookName} must be used inside <TreeDnd>. Wrap your tree rows with <TreeDnd nodes={...}>.`,
    );
  }
  // The context is declared without a type parameter; callers pick `N` to match their <TreeDnd>.
  return value as unknown as TreeInternals<N>;
}

/** Access the tree state (rows, expansion, structural moves) from anywhere inside `<TreeDnd>`. */
export function useTree<N extends TreeNodeOf<N>>(): TreeApi<N> {
  return useTreeInternals<N>("useTree");
}

const DEFAULT_TREE_INSTRUCTIONS =
  "To pick up a tree item, press space. While dragging, use the up and down arrow keys to choose a position, " +
  "then press space or enter to drop, or escape to cancel. Without dragging, hold alt and press up or down to " +
  "reorder, right to nest under the previous item, or left to move out one level.";

function defaultLabel(node: unknown, id: UniqueId): string {
  if (typeof node === "object" && node !== null) {
    for (const key of ["label", "name", "title"] as const) {
      const value = (node as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return String(id);
}

const POSITION_TEXT: Record<DropPosition, string> = {
  before: "above",
  after: "below",
  inside: "inside",
};

function allExpandable<N extends TreeNodeOf<N>>(index: TreeIndex<N>): Set<UniqueId> {
  const ids = new Set<UniqueId>();
  for (const [id, entry] of index) if (entry.node.children && entry.node.children.length > 0) ids.add(id);
  return ids;
}

const DEFAULT_SENSORS: readonly Sensor[] = [pointerSensor(), keyboardSensor({ startKeys: [" "] })];

/**
 * Drag-and-drop for nested trees. Renders a `DragDropProvider` and owns the hierarchy rules,
 * expansion state, three-zone drop intent (above / inside / below a row), keyboard navigation
 * and the Alt+Arrow keyboard fallback. Rows are rendered by you with `useTreeItem`.
 */
export function TreeDnd<N extends TreeNodeOf<N>>(props: TreeDndProps<N>): ReactNode {
  const {
    nodes,
    onChange,
    rules,
    expandedIds,
    defaultExpandedIds = "all",
    onExpandedChange,
    visibleIds,
    getLabel,
    onMoveRejected,
    sensors,
    children,
    accessibility,
    onDragEnd,
    ...provider
  } = props;

  const bridge = useRef<Bridge | null>(null);

  const announcements = useMemo(() => {
    if (accessibility?.announcements === false) return false as const;
    return {
      onDragOver: (event: { active: ActiveInfo; over: { id: UniqueId } | null }) => {
        const b = bridge.current;
        if (!b) return null;
        const name = b.labelOf(event.active.id);
        if (!event.over) return `${name} is no longer over a drop target.`;
        const intent = b.describe(event.active.id, event.over.id, event.active.activator, b.pointerY());
        const target = b.labelOf(event.over.id);
        if (!intent) return `${name} is over its original position.`;
        if (!intent.valid) {
          return `${name} cannot be dropped ${POSITION_TEXT[intent.position]} ${target}. ${intent.reason ?? ""}`.trim();
        }
        return `${name} will be placed ${POSITION_TEXT[intent.position]} ${target}.`;
      },
      // The tree speaks its own, more specific message once the move is applied.
      onDragEnd: () => null,
      ...accessibility?.announcements,
    };
  }, [accessibility?.announcements]);

  return (
    <DragDropProvider
      {...provider}
      sensors={sensors ?? DEFAULT_SENSORS}
      accessibility={{
        instructions: DEFAULT_TREE_INSTRUCTIONS,
        ...accessibility,
        announcements,
      }}
      onDragEnd={(event) => {
        bridge.current?.commit(event);
        onDragEnd?.(event);
      }}
    >
      <TreeController
        nodes={nodes}
        onChange={onChange}
        rules={rules}
        expandedIds={expandedIds}
        defaultExpandedIds={defaultExpandedIds}
        onExpandedChange={onExpandedChange}
        visibleIds={visibleIds}
        getLabel={getLabel}
        onMoveRejected={onMoveRejected}
        bridge={bridge}
      >
        {children}
      </TreeController>
    </DragDropProvider>
  );
}

interface TreeControllerProps<N extends TreeNodeOf<N>> {
  nodes: readonly N[];
  onChange: TreeDndProps<N>["onChange"];
  rules: TreeRules<N> | undefined;
  expandedIds: ReadonlySet<UniqueId> | undefined;
  defaultExpandedIds: ReadonlySet<UniqueId> | "all";
  onExpandedChange: TreeDndProps<N>["onExpandedChange"];
  visibleIds: ReadonlySet<UniqueId> | undefined;
  getLabel: TreeDndProps<N>["getLabel"];
  onMoveRejected: TreeDndProps<N>["onMoveRejected"];
  bridge: { current: Bridge | null };
  children: ReactNode;
}

const NO_RULES: TreeRules<never> = {};

function TreeController<N extends TreeNodeOf<N>>({
  nodes,
  onChange,
  rules = NO_RULES,
  expandedIds,
  defaultExpandedIds,
  onExpandedChange,
  visibleIds,
  getLabel,
  onMoveRejected,
  bridge,
  children,
}: TreeControllerProps<N>): ReactNode {
  const engine = useDragEngine();
  const index = useMemo(() => indexTree(nodes), [nodes]);

  const initialExpanded = useRef<ReadonlySet<UniqueId> | null>(null);
  if (initialExpanded.current === null) {
    initialExpanded.current =
      defaultExpandedIds === "all" ? allExpandable(index) : new Set(defaultExpandedIds);
  }
  const [expanded, setExpanded] = useControllableState<ReadonlySet<UniqueId>>({
    value: expandedIds,
    defaultValue: initialExpanded.current,
    onChange: onExpandedChange,
  });

  const rows = useMemo(
    () => flattenTree(nodes, { expandedIds: expanded, visibleIds }),
    [nodes, expanded, visibleIds],
  );

  const [focusedId, setFocusedId] = useState<UniqueId | undefined>(undefined);
  const effectiveFocusId = rows.some((row) => row.id === focusedId) ? focusedId : rows[0]?.id;
  const pendingFocus = useRef<UniqueId | null>(null);

  const latest = useRef({ nodes, index, rules, expanded, onChange, onMoveRejected, getLabel, rows });
  useIsomorphicLayoutEffect(() => {
    latest.current = { nodes, index, rules, expanded, onChange, onMoveRejected, getLabel, rows };
  });

  const labelOf = useCallback((id: UniqueId): string => {
    const node = latest.current.index.get(id)?.node;
    if (!node) return String(id);
    return latest.current.getLabel ? latest.current.getLabel(node) : defaultLabel(node, id);
  }, []);

  const focusRow = useCallback(
    (id: UniqueId | undefined) => {
      if (id === undefined) return;
      setFocusedId(id);
      const els = engine.getDraggableElements(id);
      (els?.handle ?? els?.element)?.focus({ preventScroll: false });
    },
    [engine],
  );

  // Restore focus after a keyboard move re-ordered the DOM.
  useIsomorphicLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    const els = engine.getDraggableElements(id);
    (els?.handle ?? els?.element)?.focus({ preventScroll: false });
  }, [nodes, engine]);

  // Row heights are frozen for the duration of a drag. Drop indicators (borders, hints, validation
  // text) commonly change a row's height; if the drop zone were computed from the live height, the
  // zone could flip on every render and never settle ("Maximum update depth exceeded").
  const frozenHeights = useRef(new Map<UniqueId, number>());
  useEffect(() => {
    const clear = () => frozenHeights.current.clear();
    const offs = [engine.on("dragStart", clear), engine.on("dragEnd", clear), engine.on("dragCancel", clear)];
    return () => offs.forEach((off) => off());
  }, [engine]);

  const describe = useCallback<TreeInternals<N>["describe"]>(
    (activeId, overId, activator, pointerY) => {
      const { nodes: tree, index: idx, rules: r, expanded: exp } = latest.current;
      if (activeId === overId) return null;
      const over = idx.get(overId);
      const element = engine.getDraggableElements(overId)?.element;
      if (!over || !element) return null;
      const rect = element.getBoundingClientRect();
      let height = frozenHeights.current.get(overId);
      if (height === undefined) {
        height = rect.height;
        frozenHeights.current.set(overId, height);
      }
      const allowInside = r.acceptsChildren ? r.acceptsChildren(over.node) : true;
      const position: DropPosition =
        activator === "keyboard"
          ? pointerY >= rect.top + height / 2
            ? "after"
            : "before"
          : getDropPosition({ top: rect.top, height }, pointerY, allowInside);
      const move = resolveTreeDrop(tree, { activeId, overId, position, expandedIds: exp }, idx);
      if (!move) return null;
      const verdict = canMoveNode(tree, move, r, idx);
      if (verdict.ok) {
        return { position, move, valid: true, unchanged: false, code: null, reason: null };
      }
      const unchanged = verdict.reason === "no-op";
      return {
        position,
        move,
        valid: unchanged,
        unchanged,
        code: verdict.reason,
        reason: unchanged ? null : verdict.message,
      };
    },
    [engine],
  );

  // The drop is judged at release time, when the pointer position is still known; the result is
  // remembered so `commit` applies exactly what was validated.
  const pending = useRef<{ activeId: UniqueId; overId: UniqueId; intent: TreeDropIntent } | null>(null);

  useEffect(
    () =>
      engine.addDropValidator(({ active, over }) => {
        pending.current = null;
        if (!over) return true;
        const intent = describe(active.id, over.id, active.activator, engine.motion.getState().pointer.y);
        if (!intent) return true; // dropped on itself: nothing to do, nothing to reject
        pending.current = { activeId: active.id, overId: over.id, intent };
        if (intent.valid) return true;
        latest.current.onMoveRejected?.(
          { reason: intent.code ?? "rejected", message: intent.reason ?? "This move is not allowed." },
          intent.move,
        );
        return { ok: false, reason: intent.reason ?? "This move is not allowed." };
      }),
    [engine, describe],
  );

  const expandOnly = useCallback(
    (id: UniqueId, open: boolean) => {
      setExpanded((current) => {
        if (current.has(id) === open) return current;
        const next = new Set(current);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [setExpanded],
  );

  const commit = useCallback(
    (event: DragEndEvent) => {
      const record = pending.current;
      pending.current = null;
      if (!record || !event.over || record.activeId !== event.active.id || record.overId !== event.over.id) return;
      const { intent } = record;
      if (!intent.move || intent.unchanged) {
        engine.speak(`${labelOf(event.active.id)} was dropped in its original position.`);
        return;
      }
      const { nodes: tree, rules: r, onChange: notify } = latest.current;
      const result = moveNode(tree, intent.move, r);
      if (!result.ok) {
        latest.current.onMoveRejected?.({ reason: result.reason, message: result.message }, intent.move);
        return;
      }
      if (result.move.to.parentId !== null) expandOnly(result.move.to.parentId, true);
      notify?.(result.tree, result.move);
      const target = labelOf(record.overId);
      engine.speak(`${labelOf(event.active.id)} moved ${POSITION_TEXT[intent.position]} ${target}.`);
    },
    [engine, labelOf, expandOnly],
  );

  useIsomorphicLayoutEffect(() => {
    const value: Bridge = {
      describe,
      commit,
      labelOf,
      pointerY: () => engine.motion.getState().pointer.y,
    };
    bridge.current = value;
    return () => {
      if (bridge.current === value) bridge.current = null;
    };
  }, [bridge, describe, commit, labelOf, engine]);

  const step = useCallback<TreeApi<N>["step"]>(
    (id, direction) => {
      const { nodes: tree, rules: r, onChange: notify } = latest.current;
      const result = stepMove(tree, id, direction, r);
      if (!result.ok) {
        engine.speak(result.message);
        if (result.reason !== "no-op") {
          latest.current.onMoveRejected?.({ reason: result.reason, message: result.message }, null);
        }
        return false;
      }
      pendingFocus.current = id;
      if (result.move.to.parentId !== null) expandOnly(result.move.to.parentId, true);
      notify?.(result.tree, result.move);
      const name = labelOf(id);
      const place = result.move.to.index + 1;
      engine.speak(
        direction === "indent" || direction === "outdent"
          ? `${name} moved ${direction === "indent" ? "in" : "out"} one level, position ${place}.`
          : `${name} moved ${direction}, position ${place}.`,
      );
      return true;
    },
    [engine, labelOf, expandOnly],
  );

  const api = useMemo<TreeInternals<N>>(
    () => ({
      nodes,
      rows,
      index,
      expandedIds: expanded,
      isExpanded: (id) => expanded.has(id),
      toggle: (id) => expandOnly(id, !expanded.has(id)),
      expand: (id) => expandOnly(id, true),
      collapse: (id) => expandOnly(id, false),
      expandAll: () => setExpanded(allExpandable(index)),
      collapseAll: () => setExpanded(new Set()),
      getNode: (id) => index.get(id)?.node,
      step,
      treeProps: { role: "tree" },
      engine,
      focusedId: effectiveFocusId,
      setFocusedId,
      labelOf,
      rules,
      describe,
      focusRow,
    }),
    [nodes, rows, index, expanded, expandOnly, setExpanded, step, engine, effectiveFocusId, labelOf, rules, describe, focusRow],
  );

  return <TreeContext.Provider value={api as unknown as TreeInternals<never>}>{children}</TreeContext.Provider>;
}

export interface TreeItemAttributes {
  role: "treeitem";
  tabIndex: number;
  "aria-level": number;
  "aria-posinset": number;
  "aria-setsize": number;
  "aria-expanded": boolean | undefined;
  "aria-disabled": boolean | undefined;
  "aria-roledescription": string;
  "aria-describedby": string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

export interface UseTreeItemReturn<N extends TreeNodeOf<N>> {
  readonly node: N;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** Locked nodes cannot be dragged. */
  readonly locked: boolean;
  /** Spread on the row element (it receives focus). */
  attributes: TreeItemAttributes;
  setNodeRef: (node: HTMLElement | null) => void;
  /** Optional drag handle. When used, only the handle starts drags. */
  setHandleRef: (node: HTMLElement | null) => void;
  toggle: () => void;
  isDragging: boolean;
  /** The dragged node is currently over this row. */
  isOver: boolean;
  /** Where the dragged node would land relative to this row, while it is the target. */
  dropPosition: DropPosition | null;
  /** `false` when the drop here would be rejected. `null` when this row is not the target. */
  isValidDrop: boolean | null;
  rejectionReason: string | null;
  /** Depth as a CSS custom property, handy for indentation: `padding-left: calc(var(--gripflow-depth) * 1rem)`. */
  style: CSSProperties | undefined;
}

function sameIntent(a: TreeDropIntent | null, b: TreeDropIntent | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.position === b.position &&
    a.valid === b.valid &&
    a.unchanged === b.unchanged &&
    a.reason === b.reason &&
    a.move?.parentId === b.move?.parentId &&
    a.move?.index === b.move?.index
  );
}

/**
 * Binds one visible row to the engine: draggable, droppable, ARIA tree semantics, roving
 * focus, tree keyboard navigation and Alt+Arrow structural moves.
 */
export function useTreeItem<N extends TreeNodeOf<N>>(row: FlatTreeNode<N>): UseTreeItemReturn<N> {
  const tree = useTreeInternals<N>("useTreeItem");
  const { instructionsId } = useDragDropContext("useTreeItem");
  const { engine, rules } = tree;
  const locked = rules.isLocked?.(row.node) ?? false;
  const label = tree.labelOf(row.id);

  const drag = useDraggable({ id: row.id, data: { label }, disabled: locked });
  const drop = useDroppable({ id: row.id });
  const { setNodeRef: setDragRef, setHandleRef } = drag;
  const { setNodeRef: setDropRef } = drop;
  const setNodeRef = useCallback(
    (el: HTMLElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef],
  );

  const intentSelector = useCallback(
    (motion: { pointer: { y: number } }): TreeDropIntent | null => {
      const state = engine.store.getState();
      if (!state.active || state.over?.id !== row.id) return null;
      return tree.describe(state.active.id, row.id, state.active.activator, motion.pointer.y);
    },
    [engine, row.id, tree],
  );
  const intent = useStoreSelector(engine.motion, intentSelector, sameIntent);

  const toggle = useCallback(() => tree.toggle(row.id), [tree, row.id]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (engine.getState().status !== "idle") return;
      const rows = tree.rows;
      const position = rows.findIndex((r) => r.id === row.id);

      if (event.altKey) {
        const direction =
          event.key === "ArrowUp"
            ? "up"
            : event.key === "ArrowDown"
              ? "down"
              : event.key === "ArrowRight"
                ? "indent"
                : event.key === "ArrowLeft"
                  ? "outdent"
                  : null;
        if (direction) {
          event.preventDefault();
          if (!locked) tree.step(row.id, direction);
          else engine.speak("This item is locked and cannot be moved.");
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          tree.focusRow(rows[position + 1]?.id);
          break;
        case "ArrowUp":
          event.preventDefault();
          tree.focusRow(rows[position - 1]?.id);
          break;
        case "Home":
          event.preventDefault();
          tree.focusRow(rows[0]?.id);
          break;
        case "End":
          event.preventDefault();
          tree.focusRow(rows[rows.length - 1]?.id);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (row.hasChildren && !row.expanded) tree.expand(row.id);
          else if (row.expanded) tree.focusRow(rows[position + 1]?.id);
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (row.expanded) tree.collapse(row.id);
          else if (row.parentId !== null) tree.focusRow(row.parentId);
          break;
        default:
      }
    },
    [engine, tree, row.id, row.hasChildren, row.expanded, row.parentId, locked],
  );

  const onFocus = useCallback(() => tree.setFocusedId(row.id), [tree, row.id]);

  const attributes: TreeItemAttributes = {
    role: "treeitem",
    tabIndex: tree.focusedId === row.id ? 0 : -1,
    "aria-level": row.depth + 1,
    "aria-posinset": row.posInSet,
    "aria-setsize": row.setSize,
    "aria-expanded": row.hasChildren ? row.expanded : undefined,
    "aria-disabled": locked ? true : undefined,
    "aria-roledescription": "draggable tree item",
    "aria-describedby": instructionsId,
    onKeyDown,
    onFocus,
  };

  const style: CSSProperties = {
    ...drag.style,
    ["--gripflow-depth" as string]: row.depth,
  };

  return {
    node: row.node,
    depth: row.depth,
    hasChildren: row.hasChildren,
    expanded: row.expanded,
    locked,
    attributes,
    setNodeRef,
    setHandleRef,
    toggle,
    isDragging: drag.isDragging,
    isOver: drop.isOver,
    dropPosition: intent?.position ?? null,
    isValidDrop: intent ? intent.valid : null,
    rejectionReason: intent?.reason ?? null,
    style,
  };
}
