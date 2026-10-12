/**
 * Minimal observable store used to separate low-frequency structural drag state from
 * high-frequency pointer motion. Subscribers are only notified when a value really changes.
 */
export interface Store<T> {
  getState(): T;
  /** Replaces the state; listeners are notified only if `next` differs by reference. */
  setState(next: T): void;
  /** Merges a partial update, notifying only if some field changed. */
  patch(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    getState: () => state,
    setState(next) {
      if (Object.is(next, state)) return;
      state = next;
      notify();
    },
    patch(partial) {
      let changed = false;
      for (const key of Object.keys(partial) as (keyof T)[]) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...partial };
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
