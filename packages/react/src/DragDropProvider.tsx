import { flushSync } from "react-dom";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  createStore,
  DragEngine,
  keyboardSensor,
  pointerSensor,
  type AccessibilityOptions,
  type AnimationOptions,
  type AutoScrollOptions,
  type CollisionDetector,
  type EngineHandlers,
  type EngineOptions,
  type EnginePlugin,
  type Modifier,
  type Sensor,
} from "@gripflow/core";
import { DragDropContext, type DragDropContextValue, type OverlayState } from "./context";
import { useIsomorphicLayoutEffect } from "./store-hooks";

const DEFAULT_SENSORS: readonly Sensor[] = [pointerSensor(), keyboardSensor()];

export interface DragDropProviderProps extends EngineHandlers {
  children?: ReactNode;
  /** Input sensors. Default: pointer (mouse, pen, touch) and keyboard. */
  sensors?: readonly Sensor[];
  /** Default: container-aware detection with pointer-first fallbacks. */
  collisionDetection?: CollisionDetector;
  modifiers?: readonly Modifier[];
  /** `false` disables edge auto-scrolling. */
  autoScroll?: AutoScrollOptions | boolean;
  animation?: AnimationOptions;
  accessibility?: AccessibilityOptions;
  canActivate?: EngineOptions["canActivate"];
  canDrop?: EngineOptions["canDrop"];
  validateDrop?: EngineOptions["validateDrop"];
  allowDropWithoutTarget?: boolean;
  /** Install engine plugins. Memoize the array to avoid re-installing on every render. */
  plugins?: readonly EnginePlugin[];
  /** Return focus to the dragged item after a keyboard drag ends. Default `true`. */
  restoreFocus?: boolean;
  /** Warn about duplicate ids in the console. Default `false`. */
  debug?: boolean;
  /**
   * Use an engine you created yourself (to share it, to drive it in tests...). When provided
   * the provider does not overwrite the engine's options.
   */
  engine?: DragEngine;
}

/**
 * Creates (or adopts) a drag engine and shares it with every hook below it. Must render in a
 * Client Component. Safe under React Strict Mode: the engine is created once and re-mounted.
 */
export function DragDropProvider(props: DragDropProviderProps): ReactNode {
  const {
    children,
    sensors,
    collisionDetection,
    modifiers,
    autoScroll,
    animation,
    accessibility,
    canActivate,
    canDrop,
    validateDrop,
    allowDropWithoutTarget,
    plugins,
    restoreFocus = true,
    debug,
    engine: externalEngine,
    ...handlers
  } = props;

  const reactId = useId();
  const instructionsId = `gripflow-instructions-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [ownEngine] = useState(() => new DragEngine());
  const engine = externalEngine ?? ownEngine;
  const [overlay] = useState(() => createStore<OverlayState>({ count: 0 }));

  useIsomorphicLayoutEffect(() => {
    engine.setBatch((fn) => {
      try {
        flushSync(fn);
      } catch {
        fn();
      }
    });
    return () => engine.setBatch(null);
  }, [engine]);

  useIsomorphicLayoutEffect(() => {
    if (externalEngine) return;
    engine.setOptions({
      sensors: sensors ?? DEFAULT_SENSORS,
      collisionDetection,
      modifiers,
      autoScroll,
      animation,
      accessibility: { ...accessibility, instructionsId: accessibility?.instructionsId ?? instructionsId },
      canActivate,
      canDrop,
      validateDrop,
      allowDropWithoutTarget,
      debug,
      ...handlers,
    });
  });

  useEffect(() => engine.mount(), [engine]);

  useEffect(() => {
    if (!plugins || plugins.length === 0) return;
    const removers = plugins.map((plugin) => engine.use(plugin));
    return () => removers.forEach((remove) => remove());
  }, [engine, plugins]);

  useEffect(() => {
    if (!restoreFocus) return;
    const restore = (id: string | number, activator: string) => {
      if (activator !== "keyboard") return;
      requestAnimationFrame(() => {
        const els = engine.getDraggableElements(id);
        (els?.handle ?? els?.element)?.focus({ preventScroll: true });
      });
    };
    const offEnd = engine.on("dragEnd", (e) => restore(e.active.id, e.active.activator));
    const offCancel = engine.on("dragCancel", (e) => restore(e.active.id, e.active.activator));
    return () => {
      offEnd();
      offCancel();
    };
  }, [engine, restoreFocus]);

  const value = useMemo<DragDropContextValue>(
    () => ({ engine, instructionsId: externalEngine?.getInstructionsId() ?? instructionsId, overlay }),
    [engine, externalEngine, instructionsId, overlay],
  );

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>;
}
