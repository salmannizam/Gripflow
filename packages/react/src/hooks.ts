import { useCallback, useRef, useState } from "react";
import type { DragState, MotionState } from "@gripflow/core";
import { useDragDropContext } from "./context";
import { useStoreSelector } from "./store-hooks";

/**
 * Subscribe to a slice of the structural drag state (active item, current target, validity...).
 * The component re-renders only when the selected value changes. Return primitives or stable
 * references from `select`, or pass `isEqual` for derived objects.
 */
export function useDragState<T>(
  select: (state: DragState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { engine } = useDragDropContext("useDragState");
  return useStoreSelector(engine.store, select, isEqual);
}

/**
 * Subscribe to a slice of the high-frequency pointer motion. Selecting the whole `translate`
 * re-renders on every pointer move, so prefer derived, coarse values (e.g. `m.pointer.x > 400`).
 */
export function useDragMotion<T>(
  select: (motion: MotionState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { engine } = useDragDropContext("useDragMotion");
  return useStoreSelector(engine.motion, select, isEqual);
}

export interface UseControllableStateOptions<T> {
  /** Controlled value. When `undefined` the hook manages its own state. */
  value?: T;
  /** Initial value for uncontrolled usage. */
  defaultValue: T;
  /** Called with every requested change in both modes. */
  onChange?: (next: T) => void;
}

/**
 * The classic controlled/uncontrolled helper used by the preset components. Passing `value`
 * makes the parent the source of truth; the internal state is ignored.
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateOptions<T>): [T, (next: T | ((previous: T) => T)) => void] {
  const [internal, setInternal] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const latest = useRef({ current, controlled, onChange });
  latest.current = { current, controlled, onChange };

  const set = useCallback((next: T | ((previous: T) => T)) => {
    const { current: previous, controlled: isControlled, onChange: notify } = latest.current;
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    if (Object.is(resolved, previous)) return;
    if (!isControlled) setInternal(resolved);
    notify?.(resolved);
  }, []);

  return [current, set];
}
