import { describe, expect, it } from "vitest";
import {
  applyModifiers,
  computeEdgeVelocity,
  createHistory,
  createOptimisticController,
  createRect,
  pickNextTarget,
  resolveAnimation,
  restrictToBounds,
  restrictToVerticalAxis,
  sensorsEqual,
  snapToGrid,
  pointerSensor,
  keyboardSensor,
  type ModifierArgs,
  type SessionTarget,
} from "../src";

const base: ModifierArgs = {
  activeId: "a",
  activeElement: null,
  transform: { x: 40, y: 60 },
  activeRect: createRect(100, 100, 50, 50),
  origin: { x: 125, y: 125 },
};

describe("modifiers", () => {
  it("compose in order", () => {
    expect(applyModifiers([restrictToVerticalAxis, snapToGrid(25)], base)).toEqual({ x: 0, y: 50 });
    expect(applyModifiers(undefined, base)).toEqual({ x: 40, y: 60 });
  });

  it("restrictToBounds keeps the rect inside the bounds", () => {
    const bounds = restrictToBounds(() => createRect(0, 0, 200, 200));
    expect(bounds({ ...base, transform: { x: 500, y: -500 } })).toEqual({ x: 50, y: -100 });
    expect(bounds({ ...base, transform: { x: 10, y: 10 } })).toEqual({ x: 10, y: 10 });
  });

  it("restrictToBounds is a no-op without bounds and survives bounds smaller than the item", () => {
    expect(restrictToBounds(() => null)(base)).toEqual(base.transform);
    const tiny = restrictToBounds(() => createRect(100, 100, 10, 10));
    expect(tiny({ ...base, transform: { x: 30, y: 30 } })).toEqual({ x: 0, y: 0 });
  });

  it("snapToGrid supports per-axis sizes and disabling an axis", () => {
    expect(snapToGrid({ x: 10, y: 0 })({ ...base, transform: { x: 14, y: 7 } })).toEqual({ x: 10, y: 7 });
  });
});

describe("auto-scroll velocity", () => {
  const input = { start: 0, end: 500, threshold: 100, maxSpeed: 1000, acceleration: 1 };
  it("is zero in the middle of the container", () => {
    expect(computeEdgeVelocity({ ...input, position: 250 })).toBe(0);
  });
  it("scrolls toward the start near the start edge and ramps up", () => {
    expect(computeEdgeVelocity({ ...input, position: 50 })).toBe(-500);
    expect(computeEdgeVelocity({ ...input, position: 0 })).toBe(-1000);
    expect(computeEdgeVelocity({ ...input, position: -300 })).toBe(-1000); // capped
  });
  it("scrolls toward the end near the end edge", () => {
    expect(computeEdgeVelocity({ ...input, position: 450 })).toBe(500);
  });
  it("supports acceleration curves and zero thresholds", () => {
    expect(computeEdgeVelocity({ ...input, acceleration: 2, position: 50 })).toBe(-250);
    expect(computeEdgeVelocity({ ...input, threshold: 0, position: 0 })).toBe(0);
  });
});

describe("keyboard navigation", () => {
  const t = (id: string, left: number, top: number, kind: SessionTarget["kind"] = "item", containerId?: string): SessionTarget => ({
    id,
    rect: createRect(left, top, 100, 40),
    kind,
    containerId,
  });
  const targets = [t("a", 0, 0), t("b", 0, 50), t("c", 0, 100), t("x", 300, 0)];

  it("moves to the nearest target in the pressed direction", () => {
    expect(pickNextTarget(targets, { x: 50, y: 20 }, "down")?.id).toBe("b");
    expect(pickNextTarget(targets, { x: 50, y: 70 }, "up")?.id).toBe("a");
    expect(pickNextTarget(targets, { x: 50, y: 20 }, "right")?.id).toBe("x");
  });

  it("returns nothing when there is no target that way", () => {
    expect(pickNextTarget(targets, { x: 50, y: 120 }, "down")).toBeUndefined();
    expect(pickNextTarget(targets, { x: 50, y: 20 }, "left")).toBeUndefined();
  });

  it("skips containers that already contain items but keeps empty ones", () => {
    const withContainers = [
      t("list", 0, 0, "container"),
      t("a", 0, 0, "item", "list"),
      t("empty", 0, 200, "container"),
    ];
    expect(pickNextTarget(withContainers, { x: 50, y: 20 }, "down")?.id).toBe("empty");
    expect(pickNextTarget(withContainers, { x: 50, y: -50 }, "down")?.id).toBe("a");
  });
});

describe("sensorsEqual", () => {
  it("treats sensors with equal options as equal so re-renders do not re-bind", () => {
    expect(sensorsEqual([pointerSensor({ mouse: { distance: 5 } })], [pointerSensor({ mouse: { distance: 5 } })])).toBe(true);
    expect(sensorsEqual([pointerSensor({ mouse: { distance: 5 } })], [pointerSensor({ mouse: { distance: 6 } })])).toBe(false);
    expect(sensorsEqual([pointerSensor()], [keyboardSensor()])).toBe(false);
    expect(sensorsEqual([pointerSensor()], [pointerSensor(), keyboardSensor()])).toBe(false);
    expect(sensorsEqual(undefined, undefined)).toBe(true);
  });
});

describe("animation settings", () => {
  it("respects reduced motion in auto mode", () => {
    expect(resolveAnimation(undefined, true).enabled).toBe(false);
    expect(resolveAnimation(undefined, false)).toMatchObject({ enabled: true, duration: 200 });
    expect(resolveAnimation({ enabled: true }, true).enabled).toBe(true);
    expect(resolveAnimation({ enabled: false, duration: 500 }, false).duration).toBe(0);
  });
});

describe("history", () => {
  it("supports undo and redo and drops the redo branch on push", () => {
    const h = createHistory([1]);
    h.push([1, 2]);
    h.push([1, 2, 3]);
    expect(h.undo()).toEqual([1, 2]);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toEqual([1, 2, 3]);
    h.undo();
    h.push([9]);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual([1, 2]);
  });

  it("respects the limit and ignores identical pushes", () => {
    const h = createHistory(0, { limit: 2 });
    h.push(1);
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.canUndo).toBe(false);
  });
});

describe("optimistic controller", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("applies immediately and confirms on success", async () => {
    const c = createOptimisticController(["a", "b"]);
    const done = c.commit(["b", "a"], async () => {});
    expect(c.getSnapshot().current).toEqual(["b", "a"]);
    expect(c.getSnapshot().confirmed).toEqual(["a", "b"]);
    expect((await done).ok).toBe(true);
    expect(c.getSnapshot()).toMatchObject({ confirmed: ["b", "a"], current: ["b", "a"], pending: 0 });
  });

  it("rolls back to the last confirmed state when the server rejects", async () => {
    const c = createOptimisticController(["a", "b"]);
    const result = await c.commit(["b", "a"], async () => {
      throw new Error("403");
    });
    expect(result).toMatchObject({ ok: false, reason: "rejected", state: ["a", "b"] });
    expect(c.getSnapshot().current).toEqual(["a", "b"]);
  });

  it("adopts the canonical state returned by the server", async () => {
    const c = createOptimisticController(["a", "b", "c"]);
    await c.commit(["c", "a", "b"], async () => ["a", "c", "b"]);
    expect(c.getSnapshot().current).toEqual(["a", "c", "b"]);
  });

  it("serializes saves and discards queued ones after a failure", async () => {
    const c = createOptimisticController(0);
    const calls: number[] = [];
    const first = c.commit(1, async (n) => {
      calls.push(n);
      await tick();
      throw new Error("nope");
    });
    const second = c.commit(2, async (n) => {
      calls.push(n);
    });
    expect(c.getSnapshot().current).toBe(2);
    expect((await first).ok).toBe(false);
    expect(await second).toMatchObject({ ok: false, reason: "superseded" });
    expect(calls).toEqual([1]);
    expect(c.getSnapshot()).toMatchObject({ current: 0, confirmed: 0, pending: 0 });
  });

  it("reset replaces both states", async () => {
    const c = createOptimisticController(1);
    c.reset(5);
    expect(c.getSnapshot()).toMatchObject({ current: 5, confirmed: 5 });
  });
});
