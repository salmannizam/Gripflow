import { describe, expect, it } from "vitest";
import {
  buildTree,
  canMoveNode,
  countNodes,
  filterTree,
  findNode,
  flattenTree,
  getAncestorIds,
  getDescendantIds,
  getDropPosition,
  getParentId,
  getSubtreeHeight,
  indentNode,
  indexTree,
  isDescendantOf,
  moveDown,
  moveNode,
  moveUp,
  outdentNode,
  removeNode,
  resolveTreeDrop,
  toParentList,
  updateNode,
  walkTree,
} from "../src";

interface Item {
  id: string;
  name: string;
  children?: Item[];
  locked?: boolean;
  leaf?: boolean;
  meta?: { color: string };
}

function sample(): Item[] {
  return [
    {
      id: "docs",
      name: "Docs",
      children: [
        { id: "guide", name: "Guide", children: [{ id: "intro", name: "Intro", leaf: true }] },
        { id: "api", name: "API" },
      ],
    },
    { id: "src", name: "Src", children: [{ id: "index", name: "index.ts", leaf: true, meta: { color: "blue" } }] },
    { id: "readme", name: "README", leaf: true },
  ];
}

const idsOf = (nodes: readonly Item[]): unknown =>
  nodes.map((n) => (n.children?.length ? [n.id, idsOf(n.children)] : n.id));

describe("traversal helpers", () => {
  it("indexes parents, depth and sibling positions", () => {
    const index = indexTree(sample());
    expect(index.get("intro")).toMatchObject({ parentId: "guide", depth: 2, index: 0, siblingCount: 1 });
    expect(index.get("api")).toMatchObject({ parentId: "docs", depth: 1, index: 1, siblingCount: 2 });
    expect(index.get("readme")).toMatchObject({ parentId: null, depth: 0, index: 2 });
  });

  it("throws a descriptive error for duplicate ids", () => {
    const tree: Item[] = [{ id: "a", name: "A" }, { id: "b", name: "B", children: [{ id: "a", name: "dup" }] }];
    expect(() => indexTree(tree)).toThrow(/Duplicate node id "a"/);
    expect(() => flattenTree(tree)).toThrow(/Duplicate/);
  });

  it("walks depth-first and supports early exit", () => {
    const visited: string[] = [];
    walkTree(sample(), ({ node }) => {
      visited.push(node.id);
      if (node.id === "api") return false;
      return undefined;
    });
    expect(visited).toEqual(["docs", "guide", "intro", "api"]);
  });

  it("finds nodes, parents, ancestors and descendants", () => {
    const tree = sample();
    const index = indexTree(tree);
    expect(findNode(tree, "intro")?.depth).toBe(2);
    expect(findNode(tree, "nope")).toBeNull();
    expect(getParentId(tree, "api")).toBe("docs");
    expect(getParentId(tree, "docs")).toBeNull();
    expect(getParentId(tree, "nope")).toBeUndefined();
    expect(getAncestorIds(index, "intro")).toEqual(["docs", "guide"]);
    expect(getDescendantIds(tree[0] as Item)).toEqual(["guide", "intro", "api"]);
    expect(isDescendantOf(index, "intro", "docs")).toBe(true);
    expect(isDescendantOf(index, "docs", "docs")).toBe(false);
    expect(isDescendantOf(index, "docs", "intro")).toBe(false);
    expect(getSubtreeHeight(tree[0] as Item)).toBe(2);
    expect(getSubtreeHeight(tree[2] as Item)).toBe(0);
    expect(countNodes(tree)).toBe(7);
  });

  it("flattens only the visible rows and reports aria metadata", () => {
    const rows = flattenTree(sample(), { expandedIds: new Set(["docs"]) });
    expect(rows.map((r) => r.id)).toEqual(["docs", "guide", "api", "src", "readme"]);
    const guide = rows[1];
    expect(guide).toMatchObject({ depth: 1, parentId: "docs", hasChildren: true, expanded: false, posInSet: 1, setSize: 2 });
    expect(guide?.path).toEqual(["docs", "guide"]);
    expect(flattenTree(sample()).map((r) => r.id)).toHaveLength(7);
    expect(flattenTree([])).toEqual([]);
  });

  it("filters while keeping ancestors reachable and leaves the data untouched", () => {
    const tree = sample();
    const result = filterTree(tree, (n) => n.name.toLowerCase().includes("intro"));
    expect([...result.matchedIds]).toEqual(["intro"]);
    expect([...result.ancestorIds]).toEqual(["docs", "guide"]);
    const rows = flattenTree(tree, { visibleIds: result.visibleIds });
    expect(rows.map((r) => r.id)).toEqual(["docs", "guide", "intro"]);
    expect(countNodes(tree)).toBe(7);
    const withDesc = filterTree(tree, (n) => n.id === "guide", { includeDescendants: true });
    expect([...withDesc.visibleIds].sort()).toEqual(["docs", "guide", "intro"]);
  });
});

describe("flat list conversion", () => {
  it("builds a nested tree from parent references, keeping input order and data", () => {
    const tree = buildTree(
      [
        { id: "a", parentId: null, label: "A" },
        { id: "c", parentId: "a", label: "C" },
        { id: "b", parentId: "a", label: "B" },
        { id: "orphan", parentId: "missing", label: "O" },
      ],
      (item) => item.parentId,
    );
    expect(tree.map((n) => n.id)).toEqual(["a", "orphan"]);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["c", "b"]);
    expect(tree[0]?.label).toBe("A");
  });

  it("rejects cycles and duplicate ids", () => {
    expect(() =>
      buildTree(
        [
          { id: "a", parentId: "b" },
          { id: "b", parentId: "a" },
        ],
        (i) => i.parentId,
      ),
    ).toThrow(/cycle/);
    expect(() => buildTree([{ id: "a" }, { id: "a" }], () => null)).toThrow(/Duplicate/);
  });

  it("round-trips through toParentList", () => {
    const list = toParentList(sample());
    expect(list.map((i) => [i.id, i.parentId, i.index])).toContainEqual(["api", "docs", 1]);
    const rebuilt = buildTree(list, (i) => i.parentId);
    expect(rebuilt.map((n) => n.id)).toEqual(["docs", "src", "readme"]);
    expect(findNode(rebuilt, "intro")?.parentId).toBe("guide");
  });
});

describe("immutable edits", () => {
  it("updateNode shares untouched branches and returns the same tree on no match", () => {
    const tree = sample();
    const next = updateNode(tree, "api", (n) => ({ ...n, name: "API v2" }));
    expect(findNode(next, "api")?.node.name).toBe("API v2");
    expect(next[1]).toBe(tree[1]);
    expect(tree[0]?.children?.[1]?.name).toBe("API");
    expect(updateNode(tree, "nope", (n) => n)).toBe(tree);
  });

  it("removeNode removes a subtree without mutating the input", () => {
    const tree = sample();
    const { tree: next, removed } = removeNode(tree, "guide");
    expect(removed?.id).toBe("guide");
    expect(idsOf(next)).toEqual([["docs", ["api"]], ["src", ["index"]], "readme"]);
    expect(countNodes(tree)).toBe(7);
    expect(removeNode(tree, "nope").tree).toBe(tree);
  });
});

describe("moveNode", () => {
  it("reorders siblings (index is the final position)", () => {
    const result = moveNode(sample(), { id: "readme", parentId: null, index: 0 });
    expect(result.ok && idsOf(result.tree)).toEqual(["readme", ["docs", [["guide", ["intro"]], "api"]], ["src", ["index"]]]);
    if (result.ok) expect(result.move).toEqual({ id: "readme", from: { parentId: null, index: 2 }, to: { parentId: null, index: 0 } });
  });

  it("moves a node to another parent and preserves all of its data and subtree", () => {
    const input = sample();
    const result = moveNode(input, { id: "index", parentId: "docs", index: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = findNode(result.tree, "index");
    expect(moved?.parentId).toBe("docs");
    expect(moved?.index).toBe(1);
    expect(moved?.node).toEqual({ id: "index", name: "index.ts", leaf: true, meta: { color: "blue" } });
    expect(moved?.node.meta).toBe(input[1]?.children?.[0]?.meta); // untouched data is shared, not cloned
    expect(findNode(result.tree, "src")?.node.children).toEqual([]);
  });

  it("moves a whole subtree and keeps untouched branches by reference", () => {
    const input = sample();
    const result = moveNode(input, { id: "guide", parentId: "src", index: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findNode(result.tree, "intro")?.parentId).toBe("guide");
    expect(findNode(result.tree, "intro")?.depth).toBe(2);
    expect(result.tree[2]).toBe(input[2]);
  });

  it("moves to the root level and into an empty parent", () => {
    const toRoot = moveNode(sample(), { id: "api", parentId: null, index: 1 });
    expect(toRoot.ok && idsOf(toRoot.tree)).toEqual([
      ["docs", [["guide", ["intro"]]]],
      "api",
      ["src", ["index"]],
      "readme",
    ]);
    const intoEmpty = moveNode(sample(), { id: "intro", parentId: "api", index: 0 });
    expect(intoEmpty.ok && findNode(intoEmpty.tree, "intro")?.parentId).toBe("api");
  });

  it("supports an empty tree as a destination for root insertion", () => {
    const tree: Item[] = [{ id: "a", name: "A" }];
    const result = moveNode(tree, { id: "a", parentId: null, index: 0 });
    expect(result).toMatchObject({ ok: false, reason: "no-op" });
  });

  it("does not mutate its input", () => {
    const input = sample();
    const snapshot = JSON.stringify(input);
    moveNode(input, { id: "guide", parentId: "src", index: 0 });
    moveNode(input, { id: "docs", parentId: "intro", index: 0 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  describe("rejects invalid hierarchy operations before changing anything", () => {
    it("into itself", () => {
      expect(moveNode(sample(), { id: "docs", parentId: "docs", index: 0 })).toMatchObject({ ok: false, reason: "into-self" });
    });
    it("into a descendant", () => {
      expect(moveNode(sample(), { id: "docs", parentId: "intro", index: 0 })).toMatchObject({
        ok: false,
        reason: "into-descendant",
      });
      expect(moveNode(sample(), { id: "docs", parentId: "guide", index: 0 })).toMatchObject({
        ok: false,
        reason: "into-descendant",
      });
    });
    it("unknown nodes and parents", () => {
      expect(moveNode(sample(), { id: "ghost", parentId: null, index: 0 })).toMatchObject({ ok: false, reason: "not-found" });
      expect(moveNode(sample(), { id: "api", parentId: "ghost", index: 0 })).toMatchObject({
        ok: false,
        reason: "parent-not-found",
      });
    });
    it("out of range, fractional and negative indexes", () => {
      expect(moveNode(sample(), { id: "api", parentId: "src", index: 5 })).toMatchObject({ ok: false, reason: "invalid-index" });
      expect(moveNode(sample(), { id: "api", parentId: "src", index: -1 })).toMatchObject({ ok: false, reason: "invalid-index" });
      expect(moveNode(sample(), { id: "api", parentId: "src", index: 0.5 })).toMatchObject({ ok: false, reason: "invalid-index" });
      // after removal docs has one child left, so index 2 is out of range even though it had two
      expect(moveNode(sample(), { id: "api", parentId: "docs", index: 2 })).toMatchObject({ ok: false, reason: "invalid-index" });
    });
  });

  describe("rules", () => {
    it("locked nodes cannot move but may still receive children", () => {
      const rules = { isLocked: (n: Item) => !!n.locked };
      const tree = sample().map((n) => (n.id === "readme" ? { ...n, locked: true } : n));
      expect(moveNode(tree, { id: "readme", parentId: "src", index: 0 }, rules)).toMatchObject({ ok: false, reason: "locked" });
      const result = moveNode(tree, { id: "api", parentId: "readme", index: 0 }, rules);
      expect(result.ok).toBe(true);
    });

    it("leaf nodes can refuse children", () => {
      const rules = { acceptsChildren: (n: Item) => !n.leaf };
      expect(moveNode(sample(), { id: "api", parentId: "readme", index: 0 }, rules)).toMatchObject({
        ok: false,
        reason: "parent-rejected",
      });
      expect(moveNode(sample(), { id: "api", parentId: "src", index: 0 }, rules).ok).toBe(true);
    });

    it("enforces maxDepth including the height of the moved subtree", () => {
      const rules = { maxDepth: 2 };
      // guide (height 1) under src (depth 0) -> depth 1 + 1 = 2: allowed
      expect(moveNode(sample(), { id: "guide", parentId: "src", index: 0 }, rules).ok).toBe(true);
      // docs (height 2) under src -> 1 + 2 = 3 > 2: rejected
      expect(moveNode(sample(), { id: "docs", parentId: "src", index: 0 }, rules)).toMatchObject({
        ok: false,
        reason: "max-depth",
      });
      // a leaf under intro (depth 2) -> depth 3
      expect(moveNode(sample(), { id: "readme", parentId: "intro", index: 0 }, rules)).toMatchObject({
        ok: false,
        reason: "max-depth",
      });
      // moving to the root is always depth 0
      expect(moveNode(sample(), { id: "guide", parentId: null, index: 0 }, { maxDepth: 1 }).ok).toBe(true);
    });

    it("supports custom parent-child relationship restrictions with a reason", () => {
      const rules = {
        canMove: ({ node, parent }: { node: Item; parent: Item | null }) =>
          parent === null || parent.id !== "docs" || node.leaf === true
            ? true
            : { ok: false, reason: "Docs may only contain files" },
      };
      const result = moveNode(sample(), { id: "src", parentId: "docs", index: 0 }, rules);
      expect(result).toMatchObject({ ok: false, reason: "rejected", message: "Docs may only contain files" });
      expect(moveNode(sample(), { id: "index", parentId: "docs", index: 0 }, rules).ok).toBe(true);
      expect(canMoveNode(sample(), { id: "src", parentId: "docs", index: 0 }, rules).ok).toBe(false);
    });
  });
});

describe("resolveTreeDrop", () => {
  const tree = sample();
  const index = indexTree(tree);

  it("before / after a sibling accounts for the removed node", () => {
    // readme (2) dropped before docs (0)
    expect(resolveTreeDrop(tree, { activeId: "readme", overId: "docs", position: "before" }, index)).toEqual({
      id: "readme",
      parentId: null,
      index: 0,
    });
    // docs (0) dropped after readme (2): index 3 minus the removed docs = 2
    expect(resolveTreeDrop(tree, { activeId: "docs", overId: "readme", position: "after" }, index)).toEqual({
      id: "docs",
      parentId: null,
      index: 2,
    });
    // docs (0) dropped before src (1): stays at 0 -> a no-op
    const move = resolveTreeDrop(tree, { activeId: "docs", overId: "src", position: "before" }, index);
    expect(move).toEqual({ id: "docs", parentId: null, index: 0 });
    expect(canMoveNode(tree, move as never)).toMatchObject({ ok: false, reason: "no-op" });
  });

  it("inside appends to the children of the target", () => {
    expect(resolveTreeDrop(tree, { activeId: "readme", overId: "src", position: "inside" }, index)).toEqual({
      id: "readme",
      parentId: "src",
      index: 1,
    });
    // inside its own parent = move to the end of that parent
    expect(resolveTreeDrop(tree, { activeId: "guide", overId: "docs", position: "inside" }, index)).toEqual({
      id: "guide",
      parentId: "docs",
      index: 1,
    });
  });

  it("after an expanded parent lands on its first child", () => {
    expect(
      resolveTreeDrop(tree, { activeId: "readme", overId: "docs", position: "after", expandedIds: new Set(["docs"]) }, index),
    ).toEqual({ id: "readme", parentId: "docs", index: 0 });
    expect(resolveTreeDrop(tree, { activeId: "readme", overId: "docs", position: "after", expandedIds: new Set() }, index)).toEqual({
      id: "readme",
      parentId: null,
      index: 1,
    });
  });

  it("ignores unknown ids and dropping on itself", () => {
    expect(resolveTreeDrop(tree, { activeId: "docs", overId: "docs", position: "inside" }, index)).toBeNull();
    expect(resolveTreeDrop(tree, { activeId: "ghost", overId: "docs", position: "inside" }, index)).toBeNull();
  });

  it("produces moves that the validator rejects for descendants", () => {
    const move = resolveTreeDrop(tree, { activeId: "docs", overId: "intro", position: "before" }, index);
    expect(move).not.toBeNull();
    expect(canMoveNode(tree, move as never)).toMatchObject({ ok: false, reason: "into-descendant" });
  });
});

describe("keyboard step moves", () => {
  it("moves up and down among siblings", () => {
    const up = moveUp(sample(), "src");
    expect(up.ok && idsOf(up.tree)).toEqual([["src", ["index"]], ["docs", [["guide", ["intro"]], "api"]], "readme"]);
    const down = moveDown(sample(), "docs");
    expect(down.ok && (down.tree.map((n) => n.id))).toEqual(["src", "docs", "readme"]);
    expect(moveUp(sample(), "docs")).toMatchObject({ ok: false, reason: "no-op" });
    expect(moveDown(sample(), "readme")).toMatchObject({ ok: false, reason: "no-op" });
  });

  it("indents under the previous sibling and outdents after the parent", () => {
    const indented = indentNode(sample(), "src");
    expect(indented.ok && findNode(indented.tree, "src")?.parentId).toBe("docs");
    expect(indented.ok && findNode(indented.tree, "src")?.index).toBe(2);
    const outdented = outdentNode(sample(), "api");
    expect(outdented.ok && idsOf(outdented.tree)).toEqual([
      ["docs", [["guide", ["intro"]]]],
      "api",
      ["src", ["index"]],
      "readme",
    ]);
    expect(indentNode(sample(), "docs")).toMatchObject({ ok: false, reason: "no-op" });
    expect(outdentNode(sample(), "docs")).toMatchObject({ ok: false, reason: "no-op" });
  });

  it("respects rules for step moves", () => {
    const rules = { acceptsChildren: (n: Item) => !n.leaf };
    expect(indentNode(sample(), "readme", rules).ok).toBe(true); // under src (a folder)
    const leafFirst: Item[] = [{ id: "file", name: "f", leaf: true }, { id: "other", name: "o" }];
    expect(indentNode(leafFirst, "other", rules)).toMatchObject({ ok: false, reason: "parent-rejected" });
  });
});

describe("getDropPosition", () => {
  const rect = { top: 100, height: 40 };
  it("splits a row into before / inside / after", () => {
    expect(getDropPosition(rect, 105)).toBe("before");
    expect(getDropPosition(rect, 120)).toBe("inside");
    expect(getDropPosition(rect, 136)).toBe("after");
  });
  it("uses halves for rows that cannot contain children", () => {
    expect(getDropPosition(rect, 115, false)).toBe("before");
    expect(getDropPosition(rect, 125, false)).toBe("after");
  });
  it("handles degenerate rects", () => {
    expect(getDropPosition({ top: 0, height: 0 }, 5)).toBe("inside");
  });
});
