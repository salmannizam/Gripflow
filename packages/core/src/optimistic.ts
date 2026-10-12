/**
 * Optimistic updates with rollback.
 *
 * The UI applies a change immediately (`current`) while the server decides. The last server
 * confirmed value is `confirmed`. A rejected save rolls `current` back to `confirmed`; a
 * successful save may return the *canonical* state which replaces the optimistic guess.
 * Saves run one at a time, in order, so rollbacks are deterministic.
 */
export interface OptimisticSnapshot<T> {
  readonly confirmed: T;
  readonly current: T;
  /** Saves that are in flight or waiting. */
  readonly pending: number;
}

export type CommitResult<T> =
  | { readonly ok: true; readonly state: T }
  | {
      readonly ok: false;
      readonly reason: "rejected" | "superseded";
      readonly error?: unknown;
      /** State the UI was rolled back to. */
      readonly state: T;
    };

export interface OptimisticController<T> {
  getSnapshot(): OptimisticSnapshot<T>;
  subscribe(listener: () => void): () => void;
  /**
   * Applies `next` immediately, then calls `persist(next, confirmed)`.
   * `persist` may return the canonical state; returning nothing confirms `next`.
   * Throwing/rejecting rolls back to the last confirmed state and drops queued saves.
   */
  commit(
    next: T,
    persist: (next: T, confirmed: T) => Promise<T | void> | T | void,
  ): Promise<CommitResult<T>>;
  /** Replaces both states, e.g. after reloading from the server. */
  reset(state: T): void;
}

export function createOptimisticController<T>(initial: T): OptimisticController<T> {
  let confirmed = initial;
  let current = initial;
  let pending = 0;
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  let snapshot: OptimisticSnapshot<T> = { confirmed, current, pending };
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = { confirmed, current, pending };
    for (const l of [...listeners]) l();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(state) {
      generation++;
      confirmed = state;
      current = state;
      pending = 0;
      publish();
    },
    commit(next, persist) {
      const myGeneration = generation;
      current = next;
      pending++;
      publish();
      const run = async (): Promise<CommitResult<T>> => {
        if (myGeneration !== generation) {
          pending = Math.max(0, pending - 1);
          publish();
          return { ok: false, reason: "superseded", state: current };
        }
        try {
          const canonical = await persist(next, confirmed);
          if (myGeneration !== generation) {
            pending = Math.max(0, pending - 1);
            publish();
            return { ok: false, reason: "superseded", state: current };
          }
          confirmed = canonical === undefined ? next : (canonical as T);
          pending = Math.max(0, pending - 1);
          if (pending === 0) current = confirmed;
          publish();
          return { ok: true, state: confirmed };
        } catch (error) {
          if (myGeneration === generation) {
            generation++; // invalidates saves queued after the failed one
            current = confirmed;
          }
          pending = Math.max(0, pending - 1);
          publish();
          return { ok: false, reason: "rejected", error, state: confirmed };
        }
      };
      const result = tail.then(run, run);
      tail = result;
      return result;
    },
  };
}
