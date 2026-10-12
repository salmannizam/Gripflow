import { useCallback, useMemo, useRef } from "react";
import {
  applySortableMove,
  type DragCancelEvent,
  type DragEndEvent,
  type SortableMove,
  type UniqueId,
} from "@gripflow/core";
import { useControllableState, type DragDropProviderProps } from "@gripflow/react";

/** Provider options a preset forwards to `<DragDropProvider>`. Handlers are composed, not replaced. */
export type PresetProviderProps = Omit<DragDropProviderProps, "children" | "engine">;

export interface SortableModelOptions<T> {
  /** Controlled items. When omitted the component keeps its own state. */
  items: readonly T[] | undefined;
  defaultItems: readonly T[] | undefined;
  onItemsChange: ((items: readonly T[], move: SortableMove) => void) | undefined;
  getId: (item: T) => UniqueId;
  containerId: UniqueId;
  provider: PresetProviderProps | undefined;
}

export interface SortableModel<T> {
  items: readonly T[];
  ids: readonly UniqueId[];
  byId: ReadonlyMap<UniqueId, T>;
  providerProps: PresetProviderProps;
}

const EMPTY: readonly never[] = [];

/**
 * Turns the engine's `dragEnd` into a new items array (never mutating the input) and exposes
 * it through the controlled/uncontrolled contract shared by every preset.
 */
export function useSortableModel<T>(options: SortableModelOptions<T>): SortableModel<T> {
  const { items: controlled, defaultItems, onItemsChange, getId, containerId, provider } = options;
  const [items, setItems] = useControllableState<readonly T[]>({
    value: controlled,
    defaultValue: defaultItems ?? (EMPTY as readonly T[]),
  });

  const ids = useMemo(() => items.map(getId), [items, getId]);
  const byId = useMemo(() => {
    const map = new Map<UniqueId, T>();
    for (const item of items) map.set(getId(item), item);
    return map;
  }, [items, getId]);

  const latest = useRef({ items, getId, containerId, onItemsChange, provider });
  latest.current = { items, getId, containerId, onItemsChange, provider };

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const current = latest.current;
      current.provider?.onDragEnd?.(event);
      const move = event.move;
      if (!move) return;
      const key = String(current.containerId);
      const before = { [key]: current.items };
      const after = applySortableMove(before, move, current.getId);
      const next = after[key];
      if (after === before || !next || next === current.items) return;
      setItems(next);
      current.onItemsChange?.(next, move);
    },
    [setItems],
  );

  const onDragCancel = useCallback((event: DragCancelEvent) => {
    latest.current.provider?.onDragCancel?.(event);
  }, []);

  const providerProps = useMemo<PresetProviderProps>(
    () => ({ ...provider, onDragEnd, onDragCancel }),
    [provider, onDragEnd, onDragCancel],
  );

  return { items, ids, byId, providerProps };
}
