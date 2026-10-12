// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DragEngine, restrictToHorizontalAxis, snapToGrid, type EngineEvents } from "../src";
import { createHarness, makeEl, setRect, type Harness } from "./harness";

let harness: Harness | undefined;
afterEach(() => {
  harness?.engine.destroy();
  harness = undefined;
  document.body.innerHTML = "";
});

function setup(options = {}) {
  const h = createHarness(options);
  harness = h;
  const card = makeEl([0, 0, 100, 50]);
  const zoneA = makeEl([200, 0, 200, 200]);
  const zoneB = makeEl([500, 0, 200, 200]);
  h.engine.registerDraggable({ id: "card", element: card });
  h.engine.registerDroppable({ id: "A", element: zoneA });
  h.engine.registerDroppable({ id: "B", element: zoneB });
  return { h, card, zoneA, zoneB };
}

function record(engine: Harness["engine"]) {
  const log: string[] = [];
  const names: (keyof EngineEvents)[] = [
    "activationConstraintsSatisfied",
    "dragStart",
    "dragOver",
    "dropTargetEnter",
    "dropTargetLeave",
    "dropRequested",
    "dropAccepted",
    "dropRejected",
    "dragEnd",
    "dragCancel",
  ];
  for (const name of names) engine.on(name, (p) => log.push(`${name}${"over" in p && p.over ? `:${p.over.id}` : ""}`));
  return log;
}

describe("drag lifecycle", () => {
  it("emits events in order for a successful drop", async () => {
    const { h } = setup();
    const log = record(h.engine);
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 50 });
    expect(h.engine.getState().over?.id).toBe("A");
    session.move({ x: 550, y: 50 });
    expect(h.engine.getState().over?.id).toBe("B");
    const outcome = await session.drop();
    expect(outcome.accepted).toBe(true);
    expect(log).toEqual([
      "activationConstraintsSatisfied",
      "dragStart",
      "dropTargetEnter:A",
      "dragOver:A",
      "dropTargetLeave:A",
      "dropTargetEnter:B",
      "dragOver:B",
      "dropRequested:B",
      "dropAccepted:B",
      "dragEnd:B",
    ]);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.engine.getState().status).toBe("idle");
    expect(h.engine.getState().lastResult?.type).toBe("dropped");
  });

  it("ignores a second activation while a drag is running", () => {
    const { h } = setup();
    h.begin("card");
    expect(h.controller().activate({ id: "card", activator: "x", origin: { x: 0, y: 0 }, onEnd: vi.fn() })).toBeNull();
  });

  it("cancels without a target and cleans up", async () => {
    const { h } = setup();
    const log = record(h.engine);
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 900, y: 900 });
    const outcome = await session.drop();
    expect(outcome).toEqual({ accepted: false, reason: "no-target" });
    expect(log).toContain("dragCancel");
    expect(log).not.toContain("dragEnd");
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.engine.getState().active).toBeNull();
    expect(h.engine.motion.getState().translate).toEqual({ x: 0, y: 0 });
  });

  it("accepts a drop without a target when allowDropWithoutTarget is set", async () => {
    const { h } = setup({ allowDropWithoutTarget: true });
    const ends: unknown[] = [];
    h.engine.on("dragEnd", (e) => ends.push(e.over));
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 900, y: 900 });
    expect((await session.drop()).accepted).toBe(true);
    expect(ends).toEqual([null]);
  });

  it("cancel() ends the drag, emits dragCancel with the reason and releases the sensor", () => {
    const { h } = setup();
    const reasons: string[] = [];
    h.engine.on("dragCancel", (e) => reasons.push(e.reason));
    h.begin("card");
    h.engine.cancel("escape");
    h.engine.cancel("escape"); // idempotent
    expect(reasons).toEqual(["escape"]);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  it("a session handle becomes inert after the drag ends", () => {
    const { h } = setup();
    const session = h.begin("card", { x: 50, y: 25 });
    h.engine.cancel();
    expect(session.isActive()).toBe(false);
    session.move({ x: 250, y: 25 });
    expect(h.engine.getState().over).toBeNull();
  });
});

describe("target validation", () => {
  it("marks a target invalid via canDrop and rejects the drop", async () => {
    const { h } = setup({ canDrop: ({ over }: { over: { id: unknown } | null }) => over?.id !== "A" });
    const log = record(h.engine);
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect(h.engine.getState().over?.id).toBe("A");
    expect(h.engine.getState().overValid).toBe(false);
    expect(h.engine.getState().rejectionReason).toBe("not-allowed");
    const outcome = await session.drop();
    expect(outcome.accepted).toBe(false);
    expect(log).toContain("dropRejected:A");
    expect(log).toContain("dragCancel:A");
    expect(log).not.toContain("dragEnd:A");
  });

  it("excludes targets through accepts() so the drop falls through to nothing", async () => {
    const h = createHarness();
    harness = h;
    h.engine.registerDraggable({ id: "card", element: makeEl([0, 0, 10, 10]) });
    h.engine.registerDroppable({ id: "picky", element: makeEl([100, 100, 100, 100]), accepts: () => false });
    const session = h.begin("card", { x: 5, y: 5 });
    session.move({ x: 150, y: 150 });
    expect(h.engine.getState().over).toBeNull();
  });

  it("supports async validation and exposes a validating status", async () => {
    let resolve: (v: boolean) => void = () => {};
    const { h } = setup({ validateDrop: () => new Promise<boolean>((r) => (resolve = r)) });
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    const pending = session.drop();
    expect(h.engine.getState().status).toBe("validating");
    session.move({ x: 550, y: 25 }); // movement is frozen while validating
    expect(h.engine.getState().over?.id).toBe("A");
    resolve(true);
    expect((await pending).accepted).toBe(true);
    expect(h.engine.getState().status).toBe("idle");
  });

  it("rolls back when async validation rejects with a reason", async () => {
    const { h } = setup({
      validateDrop: () => Promise.resolve({ ok: false, reason: "forbidden" }),
    });
    const rejections: string[] = [];
    h.engine.on("dropRejected", (e) => rejections.push(e.reason));
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect((await session.drop()).accepted).toBe(false);
    expect(rejections).toEqual(["forbidden"]);
    expect(h.engine.getState().lastResult?.type).toBe("cancelled");
  });

  it("treats a throwing/rejecting validator as a rejection and reports the error", async () => {
    const onError = vi.fn();
    const { h } = setup({ validateDrop: () => Promise.reject(new Error("network")), onError });
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect((await session.drop()).accepted).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: "validateDrop" }));
  });

  it("can be cancelled while validation is pending (Escape during async check)", async () => {
    let resolve: (v: boolean) => void = () => {};
    const { h } = setup({ validateDrop: () => new Promise<boolean>((r) => (resolve = r)) });
    const dragEnd = vi.fn();
    h.engine.on("dragEnd", dragEnd);
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    const pending = session.drop();
    session.cancel("escape");
    resolve(true);
    expect((await pending).accepted).toBe(false);
    expect(dragEnd).not.toHaveBeenCalled();
    expect(h.engine.getState().status).toBe("idle");
  });

  it("runs validators added by plugins", async () => {
    const { h } = setup();
    h.engine.addDropValidator(() => false);
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect((await session.drop()).accepted).toBe(false);
  });
});

describe("registry changes during a drag", () => {
  it("cancels when the dragged item is removed", async () => {
    const { h } = setup();
    const reasons: string[] = [];
    h.engine.on("dragCancel", (e) => reasons.push(e.reason));
    h.begin("card");
    h.engine.registerDraggable({ id: "other", element: makeEl([0, 0, 1, 1]) });
    // simulate unmount of the dragged component
    const reg = h.engine.registerDraggable({ id: "card", element: makeEl([0, 0, 1, 1]) });
    reg.unregister();
    await Promise.resolve();
    expect(reasons).toEqual(["source-removed"]);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  it("survives remounting the same id in the same commit", async () => {
    const h = createHarness();
    harness = h;
    const first = h.engine.registerDraggable({ id: "card", element: makeEl([0, 0, 10, 10]) });
    h.begin("card");
    first.unregister();
    h.engine.registerDraggable({ id: "card", element: makeEl([0, 0, 10, 10]) });
    await Promise.resolve();
    expect(h.engine.getState().status).toBe("dragging");
  });

  it("cancels when the dragged item becomes disabled", () => {
    const h = createHarness();
    harness = h;
    const reg = h.engine.registerDraggable({ id: "card", element: makeEl([0, 0, 10, 10]) });
    const reasons: string[] = [];
    h.engine.on("dragCancel", (e) => reasons.push(e.reason));
    h.begin("card");
    reg.update({ disabled: true });
    expect(reasons).toEqual(["source-disabled"]);
  });

  it("clears the target when it disappears mid-drag", async () => {
    const { h, zoneA } = setup();
    const left: string[] = [];
    h.engine.on("dropTargetLeave", (e) => left.push(String(e.over.id)));
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect(h.engine.getState().over?.id).toBe("A");
    // unregister the droppable behind the pointer
    const reg = h.engine.registerDroppable({ id: "A", element: zoneA });
    reg.unregister();
    await Promise.resolve();
    expect(h.engine.getState().over).toBeNull();
    expect(left).toEqual(["A"]);
    expect((await session.drop()).reason).toBe("no-target");
  });

  it("picks up targets that appear mid-drag", async () => {
    const { h } = setup();
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 900, y: 25 });
    expect(h.engine.getState().over).toBeNull();
    h.engine.registerDroppable({ id: "late", element: makeEl([800, 0, 200, 100]) });
    await Promise.resolve();
    expect(h.engine.getState().over?.id).toBe("late");
  });

  it("follows scroll containers without re-measuring everything", () => {
    const h = createHarness();
    harness = h;
    const scroller = makeEl([0, 0, 300, 300]);
    scroller.style.overflow = "auto";
    let scrollTop = 0;
    Object.defineProperty(scroller, "scrollTop", { get: () => scrollTop, configurable: true });
    const card = makeEl([400, 0, 50, 50]);
    // laid out 400px down inside the scroller, i.e. initially below its 300px viewport
    const row = makeEl([0, 400, 200, 50], scroller);
    h.engine.registerDraggable({ id: "card", element: card });
    h.engine.registerDroppable({ id: "row", element: row });
    const session = h.begin("card", { x: 425, y: 25 });
    session.move({ x: 100, y: 175 });
    expect(h.engine.getState().over).toBeNull();
    scrollTop = 250; // row is now at viewport y=150..200
    scroller.dispatchEvent(new Event("scroll"));
    expect(h.engine.getState().over?.id).toBe("row");
  });
});

describe("error handling", () => {
  it("isolates throwing listeners and keeps dragging", () => {
    const onError = vi.fn();
    const { h } = setup({ onError });
    h.engine.on("dragMove", () => {
      throw new Error("boom");
    });
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect(h.engine.getState().over?.id).toBe("A");
    expect(h.engine.getState().status).toBe("dragging");
    expect(onError).toHaveBeenCalled();
  });

  it("cancels the drag when a dragStart handler throws", () => {
    const onError = vi.fn();
    const { h } = setup({
      onError,
      onDragStart: () => {
        throw new Error("nope");
      },
    });
    expect(() => h.begin("card")).toThrow(/activation refused/);
    expect(h.engine.getState().status).toBe("idle");
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.engine.getState().lastResult?.reason).toBe("error");
  });

  it("falls back to an invalid drop when canDrop throws", async () => {
    const onError = vi.fn();
    const { h } = setup({
      onError,
      canDrop: () => {
        throw new Error("bad rule");
      },
    });
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 25 });
    expect(h.engine.getState().overValid).toBe(false);
    expect((await session.drop()).accepted).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: "canDrop" }));
  });

  it("never lets an error handler break the engine", () => {
    const { h } = setup({
      onError: () => {
        throw new Error("handler failed");
      },
      onDragMove: () => {
        throw new Error("boom");
      },
    });
    const session = h.begin("card", { x: 50, y: 25 });
    expect(() => session.move({ x: 250, y: 25 })).not.toThrow();
  });
});

describe("modifiers", () => {
  it("restricts movement and keeps the collision pointer consistent", () => {
    const { h } = setup({ modifiers: [restrictToHorizontalAxis] });
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 250, y: 900 });
    expect(h.engine.motion.getState().translate).toEqual({ x: 200, y: 0 });
    expect(h.engine.motion.getState().pointer).toEqual({ x: 250, y: 25 });
    expect(h.engine.getState().over?.id).toBe("A");
  });

  it("applies modifiers in order (snap to grid)", () => {
    const { h } = setup({ modifiers: [snapToGrid(50)] });
    const session = h.begin("card", { x: 50, y: 25 });
    session.move({ x: 80, y: 60 }); // delta (30, 35) -> rounds to (50, 50)
    expect(h.engine.motion.getState().translate).toEqual({ x: 50, y: 50 });
  });
});

describe("mount lifecycle (React Strict Mode safe)", () => {
  it("is re-mountable and cancels an active drag on unmount", () => {
    const { h } = setup();
    h.begin("card");
    h.unmount();
    expect(h.engine.getState().status).toBe("idle");
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    const again = h.engine.mount();
    again();
  });

  it("removes live region and instructions on unmount", () => {
    const engine = new DragEngine({ accessibility: { instructionsId: "ins" } });
    const unmount = engine.mount();
    expect(document.getElementById("ins")).not.toBeNull();
    expect(document.querySelector("[data-gripflow-live-region]")).not.toBeNull();
    unmount();
    expect(document.getElementById("ins")).toBeNull();
    expect(document.querySelector("[data-gripflow-live-region]")).toBeNull();
    engine.destroy();
  });
});

describe("sortable integration", () => {
  it("reports a sortable move and exposes sibling transforms while dragging", async () => {
    const h = createHarness();
    harness = h;
    const els = ["a", "b", "c"].map((id, i) => ({ id, el: makeEl([0, i * 50, 100, 40]) }));
    h.engine.registerSortable({ id: "list", items: ["a", "b", "c"] });
    for (const { id, el } of els) {
      h.engine.registerDraggable({ id, element: el });
      h.engine.registerDroppable({ id, element: el, kind: "item", containerId: "list" });
    }
    h.engine.registerDroppable({ id: "list", element: makeEl([0, 0, 100, 200]), kind: "container" });
    const moves: unknown[] = [];
    h.engine.on("dragEnd", (e) => moves.push(e.move));

    const session = h.begin("a", { x: 50, y: 20 });
    session.move({ x: 50, y: 120 });
    const projection = h.engine.getState().projection;
    expect(projection?.move).toMatchObject({ toIndex: 2, toContainerId: "list" });
    expect(projection?.transforms.get("b")).toEqual({ x: 0, y: -50 });
    await session.drop();
    expect(moves).toEqual([
      { activeId: "a", fromContainerId: "list", fromIndex: 0, toContainerId: "list", toIndex: 2 },
    ]);
    expect(h.engine.getState().projection).toBeNull();
  });

  it("does not shift siblings when the target is invalid", () => {
    const h = createHarness({ canDrop: () => ({ ok: false, reason: "locked" }) });
    harness = h;
    const els = ["a", "b"].map((id, i) => ({ id, el: makeEl([0, i * 50, 100, 40]) }));
    h.engine.registerSortable({ id: "list", items: ["a", "b"] });
    for (const { id, el } of els) {
      h.engine.registerDraggable({ id, element: el });
      h.engine.registerDroppable({ id, element: el, kind: "item", containerId: "list" });
    }
    h.engine.registerDroppable({ id: "list", element: makeEl([0, 0, 100, 100]), kind: "container" });
    const session = h.begin("a", { x: 50, y: 20 });
    session.move({ x: 50, y: 70 });
    expect(h.engine.getState().overValid).toBe(false);
    expect(h.engine.getState().projection).toBeNull();
    setRect(els[0]!.el, [0, 0, 100, 40]);
  });
});
