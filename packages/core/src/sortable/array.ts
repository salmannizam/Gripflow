import type { UniqueId } from "../primitives";

/** Describes where a sortable item came from and where it should go. Identity is the id. */
export interface SortableMove {
  readonly activeId: UniqueId;
  readonly fromContainerId: UniqueId;
  readonly fromIndex: number;
  readonly toContainerId: UniqueId;
  /** Index in the destination container *after* the item has been removed from its source. */
  readonly toIndex: number;
}

/** Items grouped by container id. */
export type ContainerItems<T> = Readonly<Record<string, readonly T[]>>;

/**
 * Returns a copy of `array` with the item at `from` moved to `to`.
 * Out-of-range indexes are clamped; `array` is never mutated.
 */
export function arrayMove<T>(array: readonly T[], from: number, to: number): T[] {
  const next = array.slice();
  if (next.length === 0 || from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(to, next.length - 1));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Returns a copy of `array` with `item` inserted at `index` (clamped). */
export function arrayInsert<T>(array: readonly T[], index: number, item: T): T[] {
  const next = array.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

/** Returns a copy of `array` without the item at `index`. */
export function arrayRemove<T>(array: readonly T[], index: number): T[] {
  const next = array.slice();
  if (index >= 0 && index < next.length) next.splice(index, 1);
  return next;
}

/**
 * Moves an item identified by `id` to `toIndex` inside one list. Looks the item up by id, so
 * stale indexes (after filtering, sorting or insertion) cannot corrupt the result.
 * Returns the same array reference when `id` is not present.
 */
export function moveById<T>(
  list: readonly T[],
  id: UniqueId,
  toIndex: number,
  getId: (item: T) => UniqueId,
): readonly T[] {
  const from = list.findIndex((item) => getId(item) === id);
  if (from < 0) return list;
  return arrayMove(list, from, toIndex);
}

/**
 * Applies a {@link SortableMove} to consumer-owned containers without mutating them.
 * The item is located by id (not trusting `move.fromIndex`). If the source container,
 * destination container or item cannot be found the *same* `containers` reference is
 * returned so callers can detect a no-op with `===`.
 */
export function applySortableMove<T>(
  containers: ContainerItems<T>,
  move: SortableMove,
  getId: (item: T) => UniqueId,
): ContainerItems<T> {
  const fromKey = String(move.fromContainerId);
  const toKey = String(move.toContainerId);
  const source = containers[fromKey];
  const destination = containers[toKey];
  if (!source || !destination) return containers;
  const fromIndex = source.findIndex((item) => getId(item) === move.activeId);
  if (fromIndex < 0) return containers;

  if (fromKey === toKey) {
    if (fromIndex === move.toIndex) return containers;
    return { ...containers, [fromKey]: arrayMove(source, fromIndex, move.toIndex) };
  }
  const item = source[fromIndex] as T;
  return {
    ...containers,
    [fromKey]: arrayRemove(source, fromIndex),
    [toKey]: arrayInsert(destination, move.toIndex, item),
  };
}

/** Convenience wrapper over {@link applySortableMove} for moving one item between containers. */
export function moveBetweenContainers<T>(
  containers: ContainerItems<T>,
  itemId: UniqueId,
  toContainerId: UniqueId,
  toIndex: number,
  getId: (item: T) => UniqueId,
): ContainerItems<T> {
  for (const [key, items] of Object.entries(containers)) {
    const fromIndex = items.findIndex((item) => getId(item) === itemId);
    if (fromIndex >= 0) {
      return applySortableMove(
        containers,
        { activeId: itemId, fromContainerId: key, fromIndex, toContainerId, toIndex },
        getId,
      );
    }
  }
  return containers;
}

/** Finds which container (by key) currently holds an item id. */
export function findContainerOf<T>(
  containers: ContainerItems<T>,
  id: UniqueId,
  getId: (item: T) => UniqueId,
): string | undefined {
  for (const [key, items] of Object.entries(containers)) {
    if (items.some((item) => getId(item) === id)) return key;
  }
  return undefined;
}
