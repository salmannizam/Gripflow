import { createContext, useContext } from "react";
import type { DragEngine, Store } from "@gripflow/core";

export interface OverlayState {
  /** Number of mounted `DragOverlay` components. */
  readonly count: number;
}

export interface DragDropContextValue {
  readonly engine: DragEngine;
  /** DOM id of the instructions element, used by `aria-describedby`. */
  readonly instructionsId: string;
  /** Lets draggables know an overlay renders the moving visual instead of the item itself. */
  readonly overlay: Store<OverlayState>;
}

export const DragDropContext = createContext<DragDropContextValue | null>(null);

/** Returns the context or throws a descriptive error when used outside a provider. */
export function useDragDropContext(hookName: string): DragDropContextValue {
  const value = useContext(DragDropContext);
  if (!value) {
    throw new Error(
      `[gripflow] ${hookName} must be used inside <DragDropProvider>. ` +
        `Wrap your tree (inside a Client Component) with <DragDropProvider>.`,
    );
  }
  return value;
}

/** Access the underlying framework-independent engine, e.g. to subscribe to events. */
export function useDragEngine(): DragEngine {
  return useDragDropContext("useDragEngine").engine;
}
