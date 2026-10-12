import { describe, expect, it } from "vitest";
import {
  applySortableMove,
  arrayInsert,
  arrayMove,
  arrayRemove,
  createRect,
  findContainerOf,
  horizontalListStrategy,
  moveBetweenContainers,
  moveById,
  rectSortingStrategy,
  SortableCoordinator,
  verticalListStrategy,
  type Rect,
} from "../src";

describe("array helpers", () => {
  it("arrayMove returns a new array and never mutates the input", () => {
    const input = Object.freeze(["a", "b", "c", "d"]);
    expect(arrayMove(input, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(arrayMove(input, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(input).toEqual(["a", "b", "c", "d"]);
  });

  it("clamps out-of-range targets and ignores invalid sources", () => {
    expect(arrayMove(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(arrayMove(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(arrayMove(["a", "b"], 9, 0)).toEqual(["a", "b"]);
    expect(arrayMove([], 0, 0)).toEqual([]);
  });

  it("arrayInsert / arrayRemove are immutable and clamp", () => {
    const base = ["a", "b"];
    expect(arrayInsert(base, 1, "x")).toEqual(["a", "x", "b"]);
    expect(arrayInsert(base, 99, "x")).toEqual(["a", "b", "x"]);
    expect(arrayRemove(base, 0)).toEqual(["b"]);
    expect(arrayRemove(base, 5)).toEqual(["a", "b"]);
    expect(base).toEqual(["a", "b"]);
  });

  it("moveById ignores stale indexes", () => {
    const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const next = moveById(list, 3, 0, (i) => i.id);
    expect(next.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(moveById(list, 99, 0, (i) => i.id)).toBe(list);
  });
});

describe("cross-container moves", () => {
  type Card = { id: string; title: string };
  const containers = {
    todo: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ],
    doing: [{ id: "c", title: "C" }],
    done: [] as Card[],
  };
  const getId = (c: Card) => c.id;

  it("moves between containers by id, preserving item data", () => {
    const next = applySortableMove(
      containers,
      { activeId: "a", fromContainerId: "todo", fromIndex: 0, toContainerId: "doing", toIndex: 1 },
      getId,
    );
    expect(next["todo"]?.map(getId)).toEqual(["b"]);
    expect(next["doing"]?.map(getId)).toEqual(["c", "a"]);
    expect(next["doing"]?.[1]).toBe(containers.todo[0]);
    expect(containers.todo).toHaveLength(2); // original untouched
  });

  it("supports empty destination containers", () => {
    const next = moveBetweenContainers(containers, "c", "done", 0, getId);
    expect(next["done"]?.map(getId)).toEqual(["c"]);
    expect(next["doing"]).toEqual([]);
  });

  it("trusts ids, not the (possibly stale) fromIndex", () => {
    const next = applySortableMove(
      containers,
      { activeId: "b", fromContainerId: "todo", fromIndex: 0, toContainerId: "done", toIndex: 0 },
      getId,
    );
    expect(next["todo"]?.map(getId)).toEqual(["a"]);
    expect(next["done"]?.map(getId)).toEqual(["b"]);
  });

  it("returns the same reference for invalid moves", () => {
    expect(
      applySortableMove(
        containers,
        { activeId: "zzz", fromContainerId: "todo", fromIndex: 0, toContainerId: "doing", toIndex: 0 },
        getId,
      ),
    ).toBe(containers);
    expect(
      applySortableMove(
        containers,
        { activeId: "a", fromContainerId: "nope", fromIndex: 0, toContainerId: "doing", toIndex: 0 },
        getId,
      ),
    ).toBe(containers);
  });

  it("reorders inside one container", () => {
    const next = applySortableMove(
      containers,
      { activeId: "a", fromContainerId: "todo", fromIndex: 0, toContainerId: "todo", toIndex: 1 },
      getId,
    );
    expect(next["todo"]?.map(getId)).toEqual(["b", "a"]);
  });

  it("finds the container of an id", () => {
    expect(findContainerOf(containers, "c", getId)).toBe("doing");
    expect(findContainerOf(containers, "x", getId)).toBeUndefined();
  });
});

function column(count: number, height = 40, gap = 10, left = 0): Rect[] {
  return Array.from({ length: count }, (_, i) => createRect(left, i * (height + gap), 100, height));
}

describe("list strategies", () => {
  const activeRect = createRect(0, 0, 100, 40);

  it("shifts items between the source and target up when moving down", () => {
    const rects = column(4);
    const t = (index: number) =>
      verticalListStrategy({ activeIndex: 0, overIndex: 2, index, rects, activeRect });
    expect(t(0)).toBeNull(); // the active item itself is handled by the drag transform
    expect(t(1)).toEqual({ x: 0, y: -50 });
    expect(t(2)).toEqual({ x: 0, y: -50 });
    expect(t(3)).toBeNull();
  });

  it("shifts items down when moving up", () => {
    const rects = column(4);
    const t = (index: number) =>
      verticalListStrategy({ activeIndex: 3, overIndex: 1, index, rects, activeRect });
    expect(t(0)).toBeNull();
    expect(t(1)).toEqual({ x: 0, y: 50 });
    expect(t(2)).toEqual({ x: 0, y: 50 });
  });

  it("opens a gap in the destination and closes it in the source", () => {
    const rects = column(3);
    const dest = (index: number) =>
      verticalListStrategy({ activeIndex: -1, overIndex: 1, index, rects, activeRect });
    expect(dest(0)).toBeNull();
    expect(dest(1)).toEqual({ x: 0, y: 50 });
    expect(dest(2)).toEqual({ x: 0, y: 50 });
    const source = (index: number) =>
      verticalListStrategy({ activeIndex: 0, overIndex: -1, index, rects, activeRect });
    expect(source(1)).toEqual({ x: 0, y: -50 });
    expect(source(2)).toEqual({ x: 0, y: -50 });
  });

  it("handles a horizontal axis", () => {
    const rects = [0, 1, 2].map((i) => createRect(i * 120, 0, 100, 40));
    const t = horizontalListStrategy({
      activeIndex: 0,
      overIndex: 1,
      index: 1,
      rects,
      activeRect: createRect(0, 0, 100, 40),
    });
    expect(t).toEqual({ x: -120, y: 0 });
  });

  it("does nothing when the item is not part of the move", () => {
    expect(
      verticalListStrategy({ activeIndex: -1, overIndex: -1, index: 0, rects: column(2), activeRect }),
    ).toBeNull();
  });

  it("respects variable item heights", () => {
    const rects = [createRect(0, 0, 100, 100), createRect(0, 110, 100, 20), createRect(0, 140, 100, 60)];
    const t = verticalListStrategy({
      activeIndex: 0,
      overIndex: 2,
      index: 1,
      rects,
      activeRect: rects[0] as Rect,
    });
    expect(t).toEqual({ x: 0, y: -110 }); // dragged height (100) + gap (10)
  });
});

describe("grid strategy", () => {
  const grid = [0, 1, 2, 3, 4, 5].map((i) =>
    createRect((i % 3) * 110, Math.floor(i / 3) * 110, 100, 100),
  );
  const activeRect = grid[0] as Rect;

  it("moves siblings into the neighbouring slot", () => {
    const t = (index: number) =>
      rectSortingStrategy({ activeIndex: 0, overIndex: 3, index, rects: grid, activeRect });
    expect(t(1)).toEqual({ x: -110, y: 0 });
    expect(t(3)).toEqual({ x: 110 * 2, y: -110 }); // wraps from row 2 col 0 -> row 1 col 2
    expect(t(4)).toBeNull();
  });

  it("extrapolates a slot after the last item when entering from another container", () => {
    const t = rectSortingStrategy({
      activeIndex: -1,
      overIndex: 5,
      index: 5,
      rects: grid,
      activeRect,
    });
    // last item (index 5, bottom right) is pushed to a new slot: wraps to the next row
    expect(t).toEqual({ x: -220, y: 110 });
  });
});

describe("SortableCoordinator", () => {
  function setup() {
    const coordinator = new SortableCoordinator();
    const rects = new Map<string | number, Rect>();
    const place = (_container: string, ids: string[], left: number) =>
      ids.forEach((id, i) => rects.set(id, createRect(left, i * 50, 100, 40)));
    place("one", ["a", "b", "c"], 0);
    place("two", ["x", "y"], 300);
    coordinator.register({ id: "one", items: ["a", "b", "c"] });
    coordinator.register({ id: "two", items: ["x", "y"] });
    const input = (activeId: string, overId: string, y = 20) => ({
      activeId,
      overId,
      collisionRect: createRect(0, y - 20, 100, 40),
      activeRect: rects.get(activeId) as Rect,
      getRect: (id: string | number) => rects.get(id),
    });
    return { coordinator, input };
  }

  it("projects a reorder inside one container", () => {
    const { coordinator, input } = setup();
    const p = coordinator.project(input("a", "c"));
    expect(p?.move).toEqual({
      activeId: "a",
      fromContainerId: "one",
      fromIndex: 0,
      toContainerId: "one",
      toIndex: 2,
    });
    expect(p?.transforms.get("b")).toEqual({ x: 0, y: -50 });
    expect(p?.transforms.get("c")).toEqual({ x: 0, y: -50 });
    expect(p?.transforms.has("a")).toBe(false);
  });

  it("projects a cross-container move and opens a gap in the destination", () => {
    const { coordinator, input } = setup();
    const p = coordinator.project(input("b", "x", 0));
    expect(p?.move).toMatchObject({ fromContainerId: "one", toContainerId: "two", toIndex: 0 });
    expect(p?.transforms.get("x")).toEqual({ x: 0, y: 50 });
    expect(p?.transforms.get("c")).toEqual({ x: 0, y: -50 });
    expect(p?.destinationSize).toBe(3);
  });

  it("inserts after the over item when the dragged rect is below its center", () => {
    const { coordinator, input } = setup();
    const p = coordinator.project(input("a", "x", 40));
    expect(p?.move.toIndex).toBe(1);
  });

  it("appends when hovering a container itself (empty or gap)", () => {
    const { coordinator, input } = setup();
    const p = coordinator.project(input("a", "two"));
    expect(p?.move).toMatchObject({ toContainerId: "two", toIndex: 2 });
  });

  it("supports empty containers", () => {
    const { coordinator, input } = setup();
    coordinator.register({ id: "empty", items: [] });
    const p = coordinator.project(input("a", "empty"));
    expect(p?.move).toMatchObject({ toContainerId: "empty", toIndex: 0 });
  });

  it("returns an identity projection when hovering the active item", () => {
    const { coordinator, input } = setup();
    const p = coordinator.project(input("b", "b"));
    expect(p?.move).toMatchObject({ fromIndex: 1, toIndex: 1 });
    expect(p?.transforms.size).toBe(0);
  });

  it("returns null for unknown targets and unknown items", () => {
    const { coordinator, input } = setup();
    expect(coordinator.project(input("a", "nothing"))).toBeNull();
    expect(coordinator.project(input("nothing", "a"))).toBeNull();
  });

  it("refuses to move into a disabled container", () => {
    const { coordinator, input } = setup();
    coordinator.register({ id: "two", items: ["x", "y"], disabled: true });
    expect(coordinator.project(input("a", "x"))).toBeNull();
    // but reordering inside the disabled container's own items is unaffected
    expect(coordinator.project(input("x", "y"))?.move.toContainerId).toBe("two");
  });

  it("memoizes the projection until something changes", () => {
    const { coordinator, input } = setup();
    expect(coordinator.project(input("a", "c"))).toBe(coordinator.project(input("a", "c")));
  });

  it("lets a container override the insertion index", () => {
    const { coordinator, input } = setup();
    coordinator.register({ id: "two", items: ["x", "y"], resolveIndex: () => 0 });
    expect(coordinator.project(input("a", "y", 60))?.move.toIndex).toBe(0);
  });

  it("uses stable ids even when items are re-registered in a new order", () => {
    const { coordinator, input } = setup();
    coordinator.register({ id: "one", items: ["c", "b", "a"] });
    const p = coordinator.project(input("a", "c"));
    expect(p?.move).toMatchObject({ fromIndex: 2, toIndex: 0 });
  });
});
