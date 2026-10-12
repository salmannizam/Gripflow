import type { Coordinates } from "../primitives";
import type { DragSession, Sensor, SensorDraggable } from "./types";
import { DEFAULT_INTERACTIVE_SELECTOR, isInteractiveTarget, noop } from "./utils";

/** Conditions that must hold before a pointer press turns into a drag. */
export interface ActivationConstraint {
  /** Pixels the pointer must travel. */
  distance?: number;
  /** Milliseconds the pointer must be held still. */
  delay?: number;
  /** Pixels of movement tolerated while waiting for `delay`; more aborts the gesture. Default `5`. */
  tolerance?: number;
}

export interface PointerSensorOptions {
  /** Constraint for mouse input. `null` activates immediately. Default `{ distance: 3 }`. */
  mouse?: ActivationConstraint | null;
  /** Constraint for touch input. Default `{ delay: 200, tolerance: 8 }` so scrolling still works. */
  touch?: ActivationConstraint | null;
  /** Constraint for pen input. Default `{ distance: 3 }`. */
  pen?: ActivationConstraint | null;
  /** CSS selector for elements that must never start a drag. Added to the defaults. */
  ignoreSelector?: string;
  /** Start drags from interactive children too (buttons, inputs...). Default `false`. */
  allowInteractive?: boolean;
  /** Final veto for a pointer press. */
  shouldStart?: (event: PointerEvent, draggable: SensorDraggable) => boolean;
}

const DEFAULTS = {
  mouse: { distance: 3 } as ActivationConstraint,
  touch: { delay: 200, tolerance: 8 } as ActivationConstraint,
  pen: { distance: 3 } as ActivationConstraint,
};

function constraintFor(options: PointerSensorOptions, type: string): ActivationConstraint | null {
  if (type === "touch") return options.touch === undefined ? DEFAULTS.touch : options.touch;
  if (type === "pen") return options.pen === undefined ? DEFAULTS.pen : options.pen;
  return options.mouse === undefined ? DEFAULTS.mouse : options.mouse;
}

/**
 * Mouse, pen and touch input through Pointer Events. Honors activation constraints, ignores
 * interactive children, keeps native scrolling on touch until the long-press fires, and cleans
 * up every listener when the drag ends.
 */
export function pointerSensor(options: PointerSensorOptions = {}): Sensor<PointerSensorOptions> {
  return {
    name: "pointer",
    options,
    bind(draggable, controller) {
      const boundary = draggable.element;
      const activator = draggable.handle ?? draggable.element;
      if (!boundary || !activator || draggable.disabled) return noop;
      const doc = activator.ownerDocument;
      const win = doc.defaultView ?? window;
      const selector = options.ignoreSelector
        ? `${DEFAULT_INTERACTIVE_SELECTOR},${options.ignoreSelector}`
        : DEFAULT_INTERACTIVE_SELECTOR;
      let abortGesture: (() => void) | null = null;

      const onDragStart = (event: Event) => event.preventDefault();
      activator.addEventListener("dragstart", onDragStart);

      const onPointerDown = (event: PointerEvent) => {
        if (abortGesture || controller.isDragging()) return;
        if (!event.isPrimary) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.defaultPrevented) return;
        if (!options.allowInteractive && isInteractiveTarget(event.target, activator, selector)) return;
        if (options.shouldStart && !options.shouldStart(event, draggable)) return;
        if (!controller.requestActivation(draggable.id, "pointer")) return;
        abortGesture = runGesture(event);
      };

      const runGesture = (down: PointerEvent): (() => void) => {
        const constraint = constraintFor(options, down.pointerType);
        const start: Coordinates = { x: down.clientX, y: down.clientY };
        const pointerId = down.pointerId;
        const isTouch = down.pointerType === "touch";
        const distanceNeeded = constraint?.distance ?? 0;
        const delayNeeded = constraint?.delay ?? 0;
        const tolerance = constraint?.tolerance ?? 5;
        let last = start;
        let session: DragSession | null = null;
        let delayElapsed = delayNeeded <= 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let finished = false;

        const listeners: Array<() => void> = [];
        const listen = <K extends keyof DocumentEventMap>(
          type: K,
          handler: (event: DocumentEventMap[K]) => void,
          opts?: AddEventListenerOptions,
        ) => {
          doc.addEventListener(type, handler, opts);
          listeners.push(() => doc.removeEventListener(type, handler, opts));
        };

        const cleanup = (wasActive: boolean) => {
          if (finished) return;
          finished = true;
          if (timer !== undefined) clearTimeout(timer);
          for (const remove of listeners.splice(0)) remove();
          win.removeEventListener("blur", onBlur);
          try {
            if (activator.hasPointerCapture?.(pointerId)) activator.releasePointerCapture(pointerId);
          } catch {
            /* element may already be detached */
          }
          if (wasActive) swallowNextClick(doc);
          abortGesture = null;
        };

        const activate = () => {
          if (session || finished) return;
          const result = controller.activate({
            id: draggable.id,
            activator: "pointer",
            origin: start,
            autoScroll: true,
            onEnd: () => cleanup(true),
          });
          if (!result) {
            cleanup(false);
            return;
          }
          session = result;
          result.move(last);
          try {
            activator.setPointerCapture(pointerId);
          } catch {
            /* capture is an enhancement; listeners on the document still work */
          }
          doc.getSelection?.()?.removeAllRanges();
        };

        const onBlur = () => {
          if (session) session.cancel("interrupted");
          else cleanup(false);
        };
        win.addEventListener("blur", onBlur);

        listen("pointermove", (event) => {
          if (event.pointerId !== pointerId) return;
          last = { x: event.clientX, y: event.clientY };
          if (session) {
            event.preventDefault();
            session.move(last);
            return;
          }
          const travelled = Math.hypot(last.x - start.x, last.y - start.y);
          if (!delayElapsed) {
            if (travelled > tolerance) cleanup(false); // moved too early: let the page scroll
            return;
          }
          if (distanceNeeded > 0 ? travelled >= distanceNeeded : true) activate();
        });
        listen("pointerup", (event) => {
          if (event.pointerId !== pointerId) return;
          if (session) {
            event.preventDefault();
            void session.drop();
          } else {
            cleanup(false);
          }
        });
        listen("pointercancel", (event) => {
          if (event.pointerId !== pointerId) return;
          if (session) session.cancel("interrupted");
          else cleanup(false);
        });
        listen(
          "keydown",
          (event) => {
            if (event.key !== "Escape") return;
            if (session) {
              event.preventDefault();
              event.stopPropagation();
              session.cancel("escape");
            } else {
              cleanup(false);
            }
          },
          { capture: true },
        );
        listen("contextmenu", (event) => event.preventDefault());
        listen("selectstart", (event) => {
          if (session) event.preventDefault();
        });
        if (isTouch) {
          // Once active, stop the browser from panning the page under the finger.
          listen(
            "touchmove",
            (event) => {
              if (session && event.cancelable) event.preventDefault();
            },
            { passive: false },
          );
        }

        if (delayNeeded > 0) {
          timer = setTimeout(() => {
            delayElapsed = true;
            if (distanceNeeded <= 0) activate();
          }, delayNeeded);
        } else if (distanceNeeded <= 0) {
          activate();
        }

        return () => {
          if (session) session.cancel("interrupted");
          else cleanup(false);
        };
      };

      activator.addEventListener("pointerdown", onPointerDown);
      return () => {
        activator.removeEventListener("pointerdown", onPointerDown);
        activator.removeEventListener("dragstart", onDragStart);
        // Only abort a gesture that has not become a drag; an active drag owns its cleanup.
        if (abortGesture) {
          const abort = abortGesture;
          queueMicrotask(() => {
            if (!controller.isDragging()) abort();
          });
        }
      };
    },
  };
}

/** After a drag, the browser still dispatches `click`; swallow it so item handlers do not fire. */
function swallowNextClick(doc: Document): void {
  const handler = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  doc.addEventListener("click", handler, { capture: true, once: true });
  setTimeout(() => doc.removeEventListener("click", handler, { capture: true }), 0);
}
