/** Undo/redo history of immutable snapshots. Framework independent. */
export interface History<T> {
  readonly present: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Records a new state, discarding any redo branch. Identical references are ignored. */
  push(next: T): T;
  undo(): T;
  redo(): T;
  /** Drops history but keeps the present state. */
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export interface HistoryOptions {
  /** Maximum number of undo steps kept. Default `100`. */
  limit?: number;
}

export function createHistory<T>(initial: T, options: HistoryOptions = {}): History<T> {
  const limit = Math.max(1, options.limit ?? 100);
  let past: T[] = [];
  let present = initial;
  let future: T[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    get present() {
      return present;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    push(next) {
      if (Object.is(next, present)) return present;
      past = [...past, present].slice(-limit);
      present = next;
      future = [];
      notify();
      return present;
    },
    undo() {
      const previous = past[past.length - 1];
      if (previous === undefined && past.length === 0) return present;
      past = past.slice(0, -1);
      future = [present, ...future];
      present = previous as T;
      notify();
      return present;
    },
    redo() {
      if (future.length === 0) return present;
      const [next, ...rest] = future;
      past = [...past, present].slice(-limit);
      present = next as T;
      future = rest;
      notify();
      return present;
    },
    clear() {
      past = [];
      future = [];
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
