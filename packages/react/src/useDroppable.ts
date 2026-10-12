import { useCallback, useEffect, useRef } from "react";
import type { ActiveInfo, DragData, DragEngine, UniqueId } from "@gripflow/core";
import { useDragDropContext } from "./context";
import { useIsomorphicLayoutEffect, useStoreSelector } from "./store-hooks";
import { useStableData } from "./useDraggable";

type DroppableRegistration = ReturnType<DragEngine["registerDroppable"]>;

export interface UseDroppableOptions {
  id: UniqueId;
  data?: DragData;
  disabled?: boolean;
  /**
   * Exclude this target for dragged items that return `false`. Excluded targets are invisible to
   * collision detection (the pointer "falls through" to whatever is behind). To keep a target
   * visible but show it as forbidden, use the provider's `canDrop` instead.
   */
  accepts?: (active: ActiveInfo) => boolean;
}

export interface UseDroppableReturn {
  setNodeRef: (node: HTMLElement | null) => void;
  /** The dragged item is currently over this target. */
  isOver: boolean;
  /** Over this target and a drop here would be accepted. */
  isValidOver: boolean;
  /** Over this target but a drop here would be rejected. Do not rely on colour alone to show it. */
  isInvalidOver: boolean;
  /** Why the drop would be rejected (from `canDrop`), if it would. */
  rejectionReason: string | null;
  /** The item being dragged, if any. */
  active: ActiveInfo | null;
}

/** Registers an element as a drop target. */
export function useDroppable({
  id,
  data,
  disabled = false,
  accepts,
}: UseDroppableOptions): UseDroppableReturn {
  const { engine } = useDragDropContext("useDroppable");
  const stableData = useStableData(data);
  const nodeRef = useRef<HTMLElement | null>(null);
  const registration = useRef<DroppableRegistration | null>(null);
  const latest = useRef({ data: stableData, disabled, accepts });
  latest.current = { data: stableData, disabled, accepts };
  // A stable function that always calls the latest `accepts`.
  const acceptsProxy = useCallback(
    (active: ActiveInfo) => latest.current.accepts?.(active) ?? true,
    [],
  );

  const setNodeRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
    registration.current?.update({ element: node });
  }, []);

  useEffect(() => {
    const reg = engine.registerDroppable({
      id,
      element: nodeRef.current,
      data: latest.current.data,
      disabled: latest.current.disabled,
      accepts: latest.current.accepts ? acceptsProxy : undefined,
    });
    registration.current = reg;
    return () => {
      reg.unregister();
      if (registration.current === reg) registration.current = null;
    };
  }, [engine, id, acceptsProxy]);

  const hasAccepts = accepts !== undefined;
  useIsomorphicLayoutEffect(() => {
    registration.current?.update({
      data: stableData,
      disabled,
      accepts: hasAccepts ? acceptsProxy : undefined,
    });
  }, [stableData, disabled, hasAccepts, acceptsProxy]);

  const isOver = useStoreSelector(engine.store, (s) => s.over?.id === id);
  const isValid = useStoreSelector(engine.store, (s) => s.over?.id === id && s.overValid);
  const reason = useStoreSelector(engine.store, (s) =>
    s.over?.id === id && !s.overValid ? s.rejectionReason : null,
  );
  const active = useStoreSelector(engine.store, (s) => s.active);

  return {
    setNodeRef,
    isOver,
    isValidOver: isOver && isValid,
    isInvalidOver: isOver && !isValid,
    rejectionReason: reason,
    active,
  };
}
