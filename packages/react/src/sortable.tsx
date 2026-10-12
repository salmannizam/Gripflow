import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  horizontalListStrategy,
  rectSortingStrategy,
  resolveAnimation,
  transitionFor,
  verticalListStrategy,
  type ActiveInfo,
  type Coordinates,
  type DragData,
  type DragEngine,
  type InsertionContext,
  type SortingStrategy,
  type UniqueId,
} from "@gripflow/core";
import { useDragDropContext } from "./context";
import { useIsomorphicLayoutEffect, useStoreSelector } from "./store-hooks";
import {
  sameNullableCoordinates,
  toTranslate3d,
  useStableData,
  type DraggableAttributes,
} from "./useDraggable";

interface SortableContainerValue {
  readonly id: UniqueId;
  readonly items: readonly UniqueId[];
  readonly indexOf: (id: UniqueId) => number;
  readonly disabled: boolean;
}

const SortableContainerContext = createContext<SortableContainerValue | null>(null);

function useContainer(hookName: string): SortableContainerValue {
  const value = useContext(SortableContainerContext);
  if (!value) {
    throw new Error(
      `[gripflow] ${hookName} must be used inside <SortableContext>. ` +
        `Render your items inside <SortableContext id="..." items={ids}>.`,
    );
  }
  return value;
}

export interface SortableContextProps {
  /** Container identity. Required when you have more than one container. Default: generated. */
  id?: UniqueId;
  /** Item ids in render order. */
  items: readonly UniqueId[];
  /** Layout axis: `"y"` (default) vertical list, `"x"` horizontal list, `"grid"` wrapping grid. */
  axis?: "x" | "y" | "grid";
  /** Custom sibling displacement. Overrides the strategy implied by `axis`. */
  strategy?: SortingStrategy;
  /** Items can still be reordered inside, but nothing moves in from other containers. */
  disabled?: boolean;
  /** Override where a dragged item is inserted. Return `null` to keep the default. */
  resolveIndex?: (context: InsertionContext) => number | null;
  children?: ReactNode;
}

function strategyFor(axis: "x" | "y" | "grid"): SortingStrategy {
  return axis === "x"
    ? horizontalListStrategy
    : axis === "grid"
      ? rectSortingStrategy
      : verticalListStrategy;
}

/**
 * Declares a sortable container and its ordered ids. The order you pass is the source of
 * truth; Gripflow never reorders it for you (apply `event.move` with `applySortableMove`).
 */
export function SortableContext({
  id,
  items,
  axis = "y",
  strategy,
  disabled = false,
  resolveIndex,
  children,
}: SortableContextProps): ReactNode {
  const { engine } = useDragDropContext("SortableContext");
  const generated = useId();
  const containerId = id ?? generated;
  const resolveRef = useRef(resolveIndex);
  resolveRef.current = resolveIndex;
  const hasResolver = resolveIndex !== undefined;

  useEffect(() => {
    return engine.registerSortable({
      id: containerId,
      items,
      axis,
      strategy: strategy ?? strategyFor(axis),
      disabled,
      resolveIndex: hasResolver ? (ctx) => resolveRef.current?.(ctx) ?? null : undefined,
    });
  }, [engine, containerId, items, axis, strategy, disabled, hasResolver]);

  const value = useMemo<SortableContainerValue>(() => {
    const indexes = new Map<UniqueId, number>();
    items.forEach((item, index) => indexes.set(item, index));
    return { id: containerId, items, indexOf: (key) => indexes.get(key) ?? -1, disabled };
  }, [containerId, items, disabled]);

  return (
    <SortableContainerContext.Provider value={value}>{children}</SortableContainerContext.Provider>
  );
}

type DraggableRegistration = ReturnType<DragEngine["registerDraggable"]>;
type DroppableRegistration = ReturnType<DragEngine["registerDroppable"]>;

export interface UseSortableContainerOptions {
  data?: DragData;
  disabled?: boolean;
  /** Only accept dragged items for which this returns `true`. */
  accepts?: (active: ActiveInfo) => boolean;
}

export interface UseSortableContainerReturn {
  /** Attach to the element that wraps the items (it is the drop target for empty containers). */
  setNodeRef: (node: HTMLElement | null) => void;
  containerId: UniqueId;
  items: readonly UniqueId[];
  /** The pointer is over this container or one of its items. */
  isOver: boolean;
  /** The dragged item would land in this container if dropped now. */
  isDropTarget: boolean;
  /** `isOver` but the drop would be rejected. Do not rely on colour alone to show it. */
  isInvalidOver: boolean;
  rejectionReason: string | null;
}

/**
 * Registers the container element as a drop target so empty containers accept drops and
 * hovering a gap resolves to "append". Call inside `<SortableContext>`.
 */
export function useSortableContainer(
  options: UseSortableContainerOptions = {},
): UseSortableContainerReturn {
  const { engine } = useDragDropContext("useSortableContainer");
  const container = useContainer("useSortableContainer");
  const data = useStableData(options.data);
  const disabled = options.disabled ?? false;
  const nodeRef = useRef<HTMLElement | null>(null);
  const registration = useRef<DroppableRegistration | null>(null);
  const acceptsRef = useRef(options.accepts);
  acceptsRef.current = options.accepts;
  const hasAccepts = options.accepts !== undefined;
  const acceptsProxy = useCallback((active: ActiveInfo) => acceptsRef.current?.(active) ?? true, []);
  const latest = useRef({ data, disabled, hasAccepts });
  latest.current = { data, disabled, hasAccepts };

  const setNodeRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
    registration.current?.update({ element: node });
  }, []);

  useEffect(() => {
    const reg = engine.registerDroppable({
      id: container.id,
      kind: "container",
      element: nodeRef.current,
      data: latest.current.data,
      disabled: latest.current.disabled,
      accepts: latest.current.hasAccepts ? acceptsProxy : undefined,
    });
    registration.current = reg;
    return () => {
      reg.unregister();
      if (registration.current === reg) registration.current = null;
    };
  }, [engine, container.id, acceptsProxy]);

  useIsomorphicLayoutEffect(() => {
    registration.current?.update({
      data,
      disabled,
      accepts: hasAccepts ? acceptsProxy : undefined,
    });
  }, [data, disabled, hasAccepts, acceptsProxy]);

  const id = container.id;
  const isOver = useStoreSelector(
    engine.store,
    (s) => s.over !== null && (s.over.id === id || s.over.containerId === id),
  );
  const isDropTarget = useStoreSelector(
    engine.store,
    (s) => s.projection?.move.toContainerId === id,
  );
  const invalid = useStoreSelector(
    engine.store,
    (s) => s.over !== null && (s.over.id === id || s.over.containerId === id) && !s.overValid,
  );
  const reason = useStoreSelector(engine.store, (s) =>
    s.over !== null && (s.over.id === id || s.over.containerId === id) && !s.overValid
      ? s.rejectionReason
      : null,
  );

  return {
    setNodeRef,
    containerId: id,
    items: container.items,
    isOver,
    isDropTarget,
    isInvalidOver: invalid,
    rejectionReason: reason,
  };
}

export interface UseSortableOptions {
  id: UniqueId;
  data?: DragData;
  /** `true` disables both dragging and acting as a target; or choose each separately. */
  disabled?: boolean | { draggable?: boolean; droppable?: boolean };
}

export interface UseSortableReturn {
  attributes: DraggableAttributes;
  setNodeRef: (node: HTMLElement | null) => void;
  /** Ref for an optional drag handle. When used, only the handle starts drags. */
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  isDragging: boolean;
  isSettling: boolean;
  /** Some item in the app is being dragged right now. */
  isSorting: boolean;
  /** The dragged item is over this item. */
  isOver: boolean;
  isInvalidOver: boolean;
  rejectionReason: string | null;
  /** Where the dragged item will be placed relative to this item, while it is the target. */
  dropPosition: "before" | "after" | null;
  /** Index in the container's `items`. `-1` if the id is missing from `items`. */
  index: number;
  containerId: UniqueId;
  transform: Coordinates | null;
  transition: string | undefined;
  /** `transform` + `transition` as a ready-made style object. */
  style: CSSProperties | undefined;
}

/**
 * A sortable item: draggable and droppable in one hook. Siblings receive `transform`s that make
 * room for the dragged item; `style` applies them.
 */
export function useSortable({ id, data, disabled = false }: UseSortableOptions): UseSortableReturn {
  const { engine, instructionsId, overlay } = useDragDropContext("useSortable");
  const container = useContainer("useSortable");
  const stableData = useStableData(data);
  const dragDisabled = (typeof disabled === "boolean" ? disabled : disabled.draggable) ?? false;
  const dropDisabled = (typeof disabled === "boolean" ? disabled : disabled.droppable) ?? false;

  const nodeRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLElement | null>(null);
  const dragReg = useRef<DraggableRegistration | null>(null);
  const dropReg = useRef<DroppableRegistration | null>(null);
  const latest = useRef({ data: stableData, dragDisabled, dropDisabled, containerId: container.id });
  latest.current = { data: stableData, dragDisabled, dropDisabled, containerId: container.id };

  const setNodeRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
    dragReg.current?.update({ element: node });
    dropReg.current?.update({ element: node });
  }, []);
  const setActivatorNodeRef = useCallback((node: HTMLElement | null) => {
    handleRef.current = node;
    dragReg.current?.update({ handle: node });
  }, []);

  useEffect(() => {
    const l = latest.current;
    const drag = engine.registerDraggable({
      id,
      element: nodeRef.current,
      handle: handleRef.current,
      data: l.data,
      disabled: l.dragDisabled,
    });
    const drop = engine.registerDroppable({
      id,
      kind: "item",
      containerId: l.containerId,
      element: nodeRef.current,
      data: l.data,
      disabled: l.dropDisabled,
    });
    dragReg.current = drag;
    dropReg.current = drop;
    return () => {
      drag.unregister();
      drop.unregister();
      if (dragReg.current === drag) dragReg.current = null;
      if (dropReg.current === drop) dropReg.current = null;
    };
  }, [engine, id]);

  useIsomorphicLayoutEffect(() => {
    dragReg.current?.update({ data: stableData, disabled: dragDisabled });
    dropReg.current?.update({
      data: stableData,
      disabled: dropDisabled,
      containerId: container.id,
    });
  }, [stableData, dragDisabled, dropDisabled, container.id]);

  const isActive = useStoreSelector(engine.store, (s) => s.active?.id === id);
  const isSettling = useStoreSelector(engine.store, (s) => s.settlingId === id);
  const isSorting = useStoreSelector(engine.store, (s) => s.active !== null);
  const hasOverlay = useStoreSelector(overlay, (s) => s.count > 0);
  const projected = useStoreSelector(engine.store, (s) => s.projection?.transforms.get(id) ?? null);
  const dragTransform = useStoreSelector(
    engine.motion,
    (m) => (engine.store.getState().active?.id === id ? m.transform : null),
    sameNullableCoordinates,
  );
  const isOver = useStoreSelector(engine.store, (s) => s.over?.id === id);
  const isInvalidOver = useStoreSelector(engine.store, (s) => s.over?.id === id && !s.overValid);
  const rejectionReason = useStoreSelector(engine.store, (s) =>
    s.over?.id === id && !s.overValid ? s.rejectionReason : null,
  );
  const index = container.indexOf(id);
  const dropPosition = useStoreSelector(engine.store, (s): "before" | "after" | null => {
    const move = s.projection?.move;
    if (s.over?.id !== id || !move || move.toContainerId !== container.id) return null;
    if (move.fromContainerId === container.id) return move.fromIndex < move.toIndex ? "after" : "before";
    return index < move.toIndex ? "after" : "before";
  });

  const transform = isActive ? (hasOverlay ? null : dragTransform) : projected;
  const animation = useMemo(
    () => (isSorting ? resolveAnimation(engine.getOptions().animation) : null),
    [engine, isSorting],
  );
  const transition = animation && !isActive ? transitionFor(animation) : undefined;
  const style: CSSProperties | undefined =
    transform || transition
      ? { transform: transform ? toTranslate3d(transform) : undefined, transition }
      : undefined;

  return {
    attributes: {
      role: "button",
      tabIndex: dragDisabled ? -1 : 0,
      "aria-roledescription": "sortable",
      "aria-describedby": instructionsId,
      "aria-disabled": dragDisabled,
      "aria-pressed": isActive,
    },
    setNodeRef,
    setActivatorNodeRef,
    isDragging: isActive || isSettling,
    isSettling,
    isSorting,
    isOver,
    isInvalidOver,
    rejectionReason,
    dropPosition,
    index,
    containerId: container.id,
    transform,
    transition,
    style,
  };
}
