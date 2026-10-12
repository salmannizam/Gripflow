import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import type { Coordinates, DragData, DragEngine, UniqueId } from "@gripflow/core";
import { useDragDropContext } from "./context";
import { useIsomorphicLayoutEffect, useStoreSelector } from "./store-hooks";

type DraggableRegistration = ReturnType<DragEngine["registerDraggable"]>;

/** Shallow-compares plain data objects so inline `data={{...}}` does not churn the engine. */
export function useStableData<T extends DragData | undefined>(data: T): T {
  const ref = useRef(data);
  const prev = ref.current;
  if (prev !== data) {
    if (
      prev &&
      data &&
      Object.keys(prev).length === Object.keys(data).length &&
      Object.keys(data).every((k) => Object.is(prev[k], data[k]))
    ) {
      return prev;
    }
    ref.current = data;
  }
  return ref.current;
}

export function toTranslate3d(t: Coordinates): string {
  return `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)`;
}

export function sameNullableCoordinates(a: Coordinates | null, b: Coordinates | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

export interface UseDraggableOptions {
  /** Stable identity. Never use an array index. */
  id: UniqueId;
  /** Echoed back in every event. `label` is used for screen-reader announcements. */
  data?: DragData;
  disabled?: boolean;
}

export interface DraggableAttributes {
  role: "button";
  tabIndex: number;
  "aria-roledescription": string;
  "aria-describedby": string;
  "aria-disabled": boolean;
  "aria-pressed": boolean;
}

export interface UseDraggableReturn {
  /** Spread on the element that receives focus and starts drags (the item or its handle). */
  attributes: DraggableAttributes;
  /** Ref for the draggable element. */
  setNodeRef: (node: HTMLElement | null) => void;
  /** Ref for an optional drag handle. When used, only the handle starts drags. */
  setHandleRef: (node: HTMLElement | null) => void;
  /** True from pick-up until the drop animation finished. */
  isDragging: boolean;
  /** True only while the drop animation plays. */
  isSettling: boolean;
  /** Movement to apply to the in-flow element (`null` unless dragging without an overlay). */
  transform: Coordinates | null;
  /** Ready-made `style` with the transform applied. `undefined` when there is nothing to apply. */
  style: CSSProperties | undefined;
}

/**
 * Makes an element draggable. Pointer, touch and keyboard input are provided by the sensors
 * configured on the provider; this hook only registers the element and exposes state.
 */
export function useDraggable({
  id,
  data,
  disabled = false,
}: UseDraggableOptions): UseDraggableReturn {
  const { engine, instructionsId, overlay } = useDragDropContext("useDraggable");
  const stableData = useStableData(data);
  const nodeRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLElement | null>(null);
  const registration = useRef<DraggableRegistration | null>(null);
  const latest = useRef({ data: stableData, disabled });
  latest.current = { data: stableData, disabled };

  const setNodeRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
    registration.current?.update({ element: node });
  }, []);
  const setHandleRef = useCallback((node: HTMLElement | null) => {
    handleRef.current = node;
    registration.current?.update({ handle: node });
  }, []);

  useEffect(() => {
    const reg = engine.registerDraggable({
      id,
      element: nodeRef.current,
      handle: handleRef.current,
      data: latest.current.data,
      disabled: latest.current.disabled,
    });
    registration.current = reg;
    return () => {
      reg.unregister();
      if (registration.current === reg) registration.current = null;
    };
  }, [engine, id]);

  useIsomorphicLayoutEffect(() => {
    registration.current?.update({ data: stableData, disabled });
  }, [stableData, disabled]);

  const isActive = useStoreSelector(engine.store, (s) => s.active?.id === id);
  const isSettling = useStoreSelector(engine.store, (s) => s.settlingId === id);
  const hasOverlay = useStoreSelector(overlay, (s) => s.count > 0);
  const transform = useStoreSelector(
    engine.motion,
    (m) => (engine.store.getState().active?.id === id ? m.transform : null),
    sameNullableCoordinates,
  );

  const isDragging = isActive || isSettling;
  const moving = isActive && !hasOverlay && transform !== null;

  return {
    attributes: {
      role: "button",
      tabIndex: disabled ? -1 : 0,
      "aria-roledescription": "draggable",
      "aria-describedby": instructionsId,
      "aria-disabled": disabled,
      "aria-pressed": isActive,
    },
    setNodeRef,
    setHandleRef,
    isDragging,
    isSettling,
    transform: moving ? transform : null,
    style: moving ? { transform: toTranslate3d(transform) } : undefined,
  };
}
