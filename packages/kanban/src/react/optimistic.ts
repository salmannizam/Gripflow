import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createOptimisticController, type OptimisticController } from "@gripflow/core";
import type { BoardChange, KanbanColumnShape } from "../types";

export interface PersistBoardArgs<Col extends KanbanColumnShape> {
  /** The board the user is looking at (already includes the optimistic move). */
  readonly columns: readonly Col[];
  /** What changed. Send this (not the whole board) to the server when you can. */
  readonly change: BoardChange;
  /** The last board the server confirmed. */
  readonly confirmed: readonly Col[];
}

export interface BoardRejection<Col extends KanbanColumnShape> {
  readonly change: BoardChange;
  readonly error: unknown;
  /** The confirmed board the UI was rolled back to. */
  readonly rolledBackTo: readonly Col[];
}

export interface UseOptimisticBoardOptions<Col extends KanbanColumnShape> {
  /**
   * Saves a change. Resolve with the *canonical* board the server holds to replace the guess, or
   * resolve with nothing to confirm the optimistic board as is. Throw/reject to roll back.
   */
  persist: (args: PersistBoardArgs<Col>) => Promise<readonly Col[] | void> | readonly Col[] | void;
  /** Called after a rejected save, once the board has been rolled back. */
  onRejected?: (rejection: BoardRejection<Col>) => void;
}

export interface UseOptimisticBoardReturn<Col extends KanbanColumnShape> {
  /** The board to render: optimistic while saves are in flight, canonical afterwards. */
  readonly columns: readonly Col[];
  /** Last board the server confirmed. */
  readonly confirmed: readonly Col[];
  /** Number of saves that are in flight or queued. */
  readonly pending: number;
  /** The most recent rejection, until the next change is applied. */
  readonly rejection: BoardRejection<Col> | null;
  /** Pass to `<KanbanDnd onChange>`. */
  readonly onChange: (columns: readonly Col[], change: BoardChange) => void;
  /** Replace the board, e.g. after reloading from the server. Cancels queued saves. */
  readonly reset: (columns: readonly Col[]) => void;
}

/**
 * Optimistic board state: the UI updates immediately, saves run one at a time in order, a failed
 * save rolls the board back to the last confirmed state, and a successful save may return the
 * server's canonical ordering. The server stays the source of truth.
 */
export function useOptimisticBoard<Col extends KanbanColumnShape>(
  initial: readonly Col[],
  options: UseOptimisticBoardOptions<Col>,
): UseOptimisticBoardReturn<Col> {
  const [controller] = useState<OptimisticController<readonly Col[]>>(() => createOptimisticController(initial));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [rejection, setRejection] = useState<BoardRejection<Col> | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onChange = useCallback(
    (columns: readonly Col[], change: BoardChange) => {
      setRejection(null);
      void controller
        .commit(columns, async (next, confirmed) =>
          latest.current.persist({ columns: next, change, confirmed }),
        )
        .then((result) => {
          if (result.ok || result.reason !== "rejected") return;
          const failed: BoardRejection<Col> = {
            change,
            error: result.error,
            rolledBackTo: result.state,
          };
          if (mounted.current) setRejection(failed);
          latest.current.onRejected?.(failed);
        });
    },
    [controller],
  );

  const reset = useCallback(
    (columns: readonly Col[]) => {
      setRejection(null);
      controller.reset(columns);
    },
    [controller],
  );

  return {
    columns: snapshot.current,
    confirmed: snapshot.confirmed,
    pending: snapshot.pending,
    rejection,
    onChange,
    reset,
  };
}
