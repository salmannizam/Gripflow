import { vi } from "vitest";
import {
  DragEngine,
  type DragSession,
  type EngineOptions,
  type Sensor,
  type SensorController,
  type UniqueId,
} from "../src";

export type RectTuple = [left: number, top: number, width: number, height: number];

/** Creates an element whose layout rect is fully controlled by the test. */
export function makeEl(rect: RectTuple, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement("div");
  const state = { rect };
  (el as unknown as { __rect: typeof state }).__rect = state;
  el.getBoundingClientRect = () => {
    const [left, top, width, height] = state.rect;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  parent.appendChild(el);
  return el;
}

export function setRect(el: HTMLElement, rect: RectTuple): void {
  (el as unknown as { __rect: { rect: RectTuple } }).__rect.rect = rect;
}

export interface Harness {
  engine: DragEngine;
  onEnd: ReturnType<typeof vi.fn>;
  /** Starts a drag as if a sensor had satisfied its activation constraints. */
  begin(id: UniqueId, origin?: { x: number; y: number }): DragSession;
  controller(): SensorController;
  unmount(): void;
}

/** An engine wired to a minimal programmable sensor - also demonstrates custom sensors. */
export function createHarness(options: EngineOptions = {}): Harness {
  let controller: SensorController | null = null;
  const onEnd = vi.fn();
  const sensor: Sensor = {
    name: "test",
    options: {},
    bind(_draggable, c) {
      controller = c;
      return () => {};
    },
  };
  const engine = new DragEngine({ sensors: [sensor], accessibility: { announcements: false, instructions: false }, ...options });
  const unmount = engine.mount();
  return {
    engine,
    onEnd,
    controller: () => {
      if (!controller) throw new Error("register a draggable first");
      return controller;
    },
    begin(id, origin = { x: 0, y: 0 }) {
      if (!controller) throw new Error("register a draggable first");
      const session = controller.activate({ id, activator: "test", origin, onEnd });
      if (!session) throw new Error("activation refused");
      return session;
    },
    unmount,
  };
}
