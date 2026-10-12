import { getLayoutRect } from "../measure";
import { rectCenter, toRect } from "../geometry";
import type { Coordinates } from "../primitives";
import type { Sensor, SessionTarget } from "./types";
import { noop } from "./utils";

export type Direction = "up" | "down" | "left" | "right";

export interface KeyboardSensorOptions {
  /** Keys that pick an item up. Default `["Enter", " "]`. */
  startKeys?: readonly string[];
  /** Keys that drop. Default `["Enter", " "]`. */
  endKeys?: readonly string[];
  /** Keys that cancel. Default `["Escape"]`. */
  cancelKeys?: readonly string[];
  /** Pixels moved per arrow press when there is no target to jump to (free movement). Default `25`. */
  step?: number;
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Chooses the nearest target in `direction` from `from`. Scoring favours targets that are
 * straight ahead (cross-axis distance counts double). Ties are broken by id for determinism.
 * Containers that already contain items are skipped so you land on items, not their wrappers.
 */
export function pickNextTarget(
  targets: readonly SessionTarget[],
  from: Coordinates,
  direction: Direction,
): SessionTarget | undefined {
  const populated = new Set<unknown>();
  for (const t of targets) if (t.kind === "item" && t.containerId !== undefined) populated.add(t.containerId);
  let best: SessionTarget | undefined;
  let bestScore = Infinity;
  for (const target of targets) {
    if (target.kind === "container" && populated.has(target.id)) continue;
    const c = rectCenter(target.rect);
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    let primary: number;
    let cross: number;
    switch (direction) {
      case "down":
        primary = dy;
        cross = Math.abs(dx);
        break;
      case "up":
        primary = -dy;
        cross = Math.abs(dx);
        break;
      case "right":
        primary = dx;
        cross = Math.abs(dy);
        break;
      case "left":
        primary = -dx;
        cross = Math.abs(dy);
        break;
    }
    if (primary <= 0.5) continue;
    const score = primary + cross * 2;
    if (
      score < bestScore ||
      (score === bestScore && best !== undefined && String(target.id) < String(best.id))
    ) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Keyboard dragging: Enter/Space picks up, arrows jump between targets (or move freely when
 * the page has no targets), Enter/Space drops, Escape cancels. Only triggers when the
 * activator itself has focus, so typing inside nested inputs is unaffected.
 */
export function keyboardSensor(options: KeyboardSensorOptions = {}): Sensor<KeyboardSensorOptions> {
  const startKeys = options.startKeys ?? ["Enter", " "];
  const endKeys = options.endKeys ?? ["Enter", " "];
  const cancelKeys = options.cancelKeys ?? ["Escape"];
  const step = options.step ?? 25;

  return {
    name: "keyboard",
    options,
    bind(draggable, controller) {
      const boundary = draggable.element;
      const activator = draggable.handle ?? draggable.element;
      if (!boundary || !activator || draggable.disabled) return noop;
      const doc = activator.ownerDocument;
      const win = doc.defaultView ?? window;

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.target !== activator) return;
        if (!startKeys.includes(event.key)) return;
        if (event.repeat || controller.isDragging()) return;
        if (!controller.requestActivation(draggable.id, "keyboard")) return;
        event.preventDefault();

        const rect = toRect(getLayoutRect(boundary));
        const center = rectCenter(rect);
        const listeners: Array<() => void> = [];
        let finished = false;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          for (const remove of listeners.splice(0)) remove();
          win.removeEventListener("blur", onWindowBlur);
        };
        const session = controller.activate({
          id: draggable.id,
          activator: "keyboard",
          origin: center,
          autoScroll: false,
          onEnd: cleanup,
        });
        if (!session) {
          cleanup();
          return;
        }

        const onWindowBlur = () => session.cancel("interrupted");
        win.addEventListener("blur", onWindowBlur);

        const handleKey = (e: KeyboardEvent) => {
          if (cancelKeys.includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            session.cancel("escape");
            return;
          }
          if (endKeys.includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            void session.drop();
            return;
          }
          if (e.key === "Tab") {
            session.cancel("interrupted");
            return;
          }
          const direction = ARROWS[e.key];
          if (!direction) return;
          e.preventDefault();
          e.stopPropagation();
          const from = session.getPointer();
          const targets = session.getTargets();
          if (targets.length === 0) {
            const amount = (e.shiftKey ? 4 : 1) * step;
            const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
            const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
            session.move({ x: from.x + dx, y: from.y + dy });
            return;
          }
          const next = pickNextTarget(targets, from, direction);
          if (!next) return;
          const rect2 = session.reveal(next.id) ?? next.rect;
          const c = rectCenter(rect2);
          // Nudge past the centre so moving "forward" lands after the target, "backward" before it.
          const nudge = direction === "down" || direction === "right" ? 1 : -1;
          session.move(
            direction === "up" || direction === "down"
              ? { x: c.x, y: c.y + nudge }
              : { x: c.x + nudge, y: c.y },
          );
        };
        doc.addEventListener("keydown", handleKey, { capture: true });
        listeners.push(() => doc.removeEventListener("keydown", handleKey, { capture: true }));

        const onPointerDown = () => session.cancel("interrupted");
        doc.addEventListener("pointerdown", onPointerDown, { capture: true });
        listeners.push(() => doc.removeEventListener("pointerdown", onPointerDown, { capture: true }));
      };

      activator.addEventListener("keydown", onKeyDown);
      return () => activator.removeEventListener("keydown", onKeyDown);
    },
  };
}
