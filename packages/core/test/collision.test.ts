import { describe, expect, it } from "vitest";
import {
  closestCenter,
  closestCorners,
  composeDetectors,
  containerAware,
  createRect,
  limitDistance,
  pointerWithin,
  prioritizeNested,
  rectIntersection,
  shapeWithin,
  type CollisionArgs,
  type DroppableSnapshot,
} from "../src";

let order = 0;
function drop(
  id: string,
  rect: [number, number, number, number],
  extra: Partial<DroppableSnapshot> = {},
): DroppableSnapshot {
  return {
    id,
    rect: createRect(...rect),
    kind: "target",
    containerId: undefined,
    depth: 0,
    order: order++,
    data: undefined,
    ...extra,
  };
}

function args(
  droppables: DroppableSnapshot[],
  rect: [number, number, number, number],
  pointer = { x: rect[0] + rect[2] / 2, y: rect[1] + rect[3] / 2 },
): CollisionArgs {
  return { activeId: "active", collisionRect: createRect(...rect), pointer, droppables };
}

const ids = (c: { id: string | number }[]) => c.map((x) => x.id);

describe("pointerWithin", () => {
  it("returns only targets containing the pointer", () => {
    const a = drop("a", [0, 0, 100, 100]);
    const b = drop("b", [200, 0, 100, 100]);
    expect(ids(pointerWithin(args([a, b], [0, 0, 10, 10], { x: 50, y: 50 })))).toEqual(["a"]);
  });

  it("prefers the deepest nested target, then the smallest", () => {
    const parent = drop("parent", [0, 0, 400, 400], { depth: 0 });
    const child = drop("child", [100, 100, 100, 100], { depth: 1 });
    const result = pointerWithin(args([parent, child], [0, 0, 10, 10], { x: 150, y: 150 }));
    expect(ids(result)).toEqual(["child", "parent"]);
  });

  it("returns nothing when the pointer is outside every target", () => {
    expect(pointerWithin(args([drop("a", [0, 0, 10, 10])], [0, 0, 5, 5], { x: 500, y: 500 }))).toEqual([]);
  });
});

describe("rectIntersection", () => {
  it("orders by overlap ratio and ignores non-overlapping targets", () => {
    const near = drop("near", [0, 0, 100, 100]);
    const far = drop("far", [500, 500, 100, 100]);
    const partial = drop("partial", [80, 0, 100, 100]);
    const result = rectIntersection(args([far, partial, near], [0, 0, 100, 100]));
    expect(ids(result)).toEqual(["near", "partial"]);
  });
});

describe("closestCenter", () => {
  it("orders every target by distance to the dragged center", () => {
    const a = drop("a", [0, 0, 100, 100]);
    const b = drop("b", [0, 200, 100, 100]);
    const c = drop("c", [0, 400, 100, 100]);
    expect(ids(closestCenter(args([c, b, a], [0, 150, 100, 100])))).toEqual(["b", "a", "c"]);
  });

  it("is deterministic on ties: registration order wins", () => {
    const first = drop("z-first", [0, 0, 100, 100]);
    const second = drop("a-second", [200, 0, 100, 100]);
    const result = closestCenter(args([second, first], [100, 0, 100, 100]));
    expect(ids(result)).toEqual(["z-first", "a-second"]);
  });

  it("prefers the deeper (nested) target on a tie", () => {
    const outer = drop("outer", [0, 0, 100, 100], { depth: 0 });
    const inner = drop("inner", [0, 0, 100, 100], { depth: 1 });
    expect(ids(closestCenter(args([outer, inner], [0, 0, 100, 100])))).toEqual(["inner", "outer"]);
  });

  it("handles zero targets", () => {
    expect(closestCenter(args([], [0, 0, 10, 10]))).toEqual([]);
  });
});

describe("closestCorners", () => {
  it("orders by summed corner distance", () => {
    const a = drop("a", [0, 0, 100, 100]);
    const b = drop("b", [300, 0, 100, 100]);
    expect(ids(closestCorners(args([b, a], [20, 0, 100, 100])))).toEqual(["a", "b"]);
  });
});

describe("shapeWithin", () => {
  const triangle = (d: DroppableSnapshot) => [
    { x: d.rect.left, y: d.rect.bottom },
    { x: d.rect.right, y: d.rect.bottom },
    { x: d.rect.left, y: d.rect.top },
  ];

  it("respects non-rectangular geometry", () => {
    const t = drop("tri", [0, 0, 100, 100]);
    const detect = shapeWithin(triangle);
    expect(ids(detect(args([t], [0, 0, 1, 1], { x: 10, y: 90 })))).toEqual(["tri"]);
    // inside the bounding box but outside the triangle
    expect(detect(args([t], [0, 0, 1, 1], { x: 90, y: 10 }))).toEqual([]);
  });

  it("falls back to the rectangle when no shape is provided", () => {
    const t = drop("box", [0, 0, 100, 100]);
    expect(ids(shapeWithin(() => null)(args([t], [0, 0, 1, 1], { x: 90, y: 10 })))).toEqual(["box"]);
  });
});

describe("composition helpers", () => {
  it("composeDetectors uses the first non-empty result", () => {
    const a = drop("a", [0, 0, 10, 10]);
    const detect = composeDetectors(pointerWithin, closestCenter);
    expect(ids(detect(args([a], [100, 100, 5, 5], { x: 500, y: 500 })))).toEqual(["a"]);
    expect(ids(detect(args([a], [0, 0, 5, 5], { x: 5, y: 5 })))).toEqual(["a"]);
  });

  it("limitDistance drops far targets", () => {
    const near = drop("near", [0, 0, 10, 10]);
    const far = drop("far", [1000, 0, 10, 10]);
    const detect = limitDistance(closestCenter, 100);
    expect(ids(detect(args([near, far], [0, 0, 10, 10])))).toEqual(["near"]);
  });

  it("prioritizeNested moves deeper targets first while keeping stable order", () => {
    const a = drop("a", [0, 0, 100, 100], { depth: 0 });
    const b = drop("b", [0, 0, 100, 100], { depth: 2 });
    const c = drop("c", [0, 0, 100, 100], { depth: 2 });
    const detect = prioritizeNested(() => [
      { id: "a", value: 0, droppable: a },
      { id: "b", value: 1, droppable: b },
      { id: "c", value: 2, droppable: c },
    ]);
    expect(ids(detect(args([a, b, c], [0, 0, 1, 1])))).toEqual(["b", "c", "a"]);
  });
});

describe("containerAware", () => {
  const column1 = drop("col1", [0, 0, 200, 600], { kind: "container" });
  const column2 = drop("col2", [300, 0, 200, 600], { kind: "container" });
  const cardA = drop("a", [10, 10, 180, 100], { kind: "item", containerId: "col1" });
  const cardB = drop("b", [10, 200, 180, 100], { kind: "item", containerId: "col1" });
  const cardC = drop("c", [310, 10, 180, 100], { kind: "item", containerId: "col2" });
  const all = [column1, column2, cardA, cardB, cardC];
  const detect = containerAware();

  it("picks the closest item inside the container under the pointer", () => {
    const result = detect(args(all, [10, 190, 180, 100], { x: 100, y: 240 }));
    expect(result[0]?.id).toBe("b");
  });

  it("only considers items of the container the pointer is in", () => {
    const result = detect(args(all, [310, 190, 180, 100], { x: 400, y: 240 }));
    expect(result[0]?.id).toBe("c");
    expect(ids(result)).not.toContain("a");
  });

  it("resolves an empty container to the container itself", () => {
    const empty = drop("empty", [600, 0, 200, 600], { kind: "container" });
    const result = detect(args([...all, empty], [610, 10, 100, 50], { x: 700, y: 100 }));
    expect(result[0]?.id).toBe("empty");
  });

  it("returns no target when the pointer is outside every container", () => {
    expect(detect(args(all, [900, 900, 10, 10], { x: 905, y: 905 }))).toEqual([]);
  });

  it("lets a nested plain target above a container win", () => {
    const trash = drop("trash", [20, 20, 50, 50], { kind: "target", depth: 1 });
    const result = detect(args([...all, trash], [20, 20, 10, 10], { x: 30, y: 30 }));
    expect(result[0]?.id).toBe("trash");
  });

  it("works with only plain targets", () => {
    const zone = drop("zone", [0, 0, 100, 100]);
    expect(ids(detect(args([zone], [0, 0, 10, 10], { x: 5, y: 5 })))).toEqual(["zone"]);
  });

  it("regression: hit-tests sortable items whose container has no element of its own", () => {
    const first = drop("first", [0, 0, 200, 50], { kind: "item", containerId: "list" });
    const second = drop("second", [0, 50, 200, 50], { kind: "item", containerId: "list" });
    const result = detect(args([first, second], [0, 40, 200, 50], { x: 100, y: 75 }));
    expect(result[0]?.id).toBe("second");
    expect(detect(args([first, second], [900, 900, 10, 10], { x: 905, y: 905 }))).toEqual([]);
  });

  it("regression: items of a container without an element do not disturb elemented containers", () => {
    const orphan = drop("orphan", [900, 0, 100, 50], { kind: "item", containerId: "no-element" });
    const result = detect(args([...all, orphan], [310, 190, 180, 100], { x: 400, y: 240 }));
    expect(result[0]?.id).toBe("c");
  });
});
