import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Store } from "@gripflow/core";

/** `useLayoutEffect` without the server-side warning. */
export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Subscribes to a slice of an engine store. The component only re-renders when the selected
 * value changes (by `isEqual`, `Object.is` by default), which is what keeps hundreds of
 * sortable items from re-rendering on every pointer move.
 */
export function useStoreSelector<S, T>(
  store: Store<S>,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const last = useRef<{ value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const next = selector(store.getState());
    const prev = last.current;
    if (prev && isEqual(prev.value, next)) return prev.value;
    last.current = { value: next };
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
