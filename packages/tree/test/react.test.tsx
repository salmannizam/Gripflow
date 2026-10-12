// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { filterTree, findNode, type AppliedTreeMove, type TreeRules } from "../src";
import { TreeDnd, useTree, useTreeItem, type TreeDndProps, type TreeMoveFailure } from "../src/react";

interface Item {
  id: string;
  name: string;
  children?: Item[];
  locked?: boolean;
  leaf?: boolean;
}

const sample = (): Item[] => [
  {
    id: "docs",
    name: "Docs",
    children: [
      { id: "guide", name: "Guide", children: [{ id: "intro", name: "Intro", leaf: true }] },
      { id: "api", name: "API" },
    ],
  },
  { id: "src", name: "Src", children: [{ id: "index", name: "index.ts", leaf: true }] },
  { id: "readme", name: "README", leaf: true },
];

const ROW_HEIGHT = 40;
let restoreRects: () => void;
beforeAll(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const [left = 0, top = 0, width = 0, height = 0] = (this.getAttribute("data-rect") ?? "").split(",").map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  };
  restoreRects = () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
});
afterAll(() => restoreRects());
afterEach(() => cleanup());

function Row({ row, top }: { row: ReturnType<typeof useTree<Item>>["rows"][number]; top: number }): ReactNode {
  const item = useTreeItem(row);
  return (
    <div
      ref={item.setNodeRef}
      {...item.attributes}
      data-testid={`row-${row.id}`}
      data-rect={`0,${top},300,${ROW_HEIGHT}`}
      data-drop={item.dropPosition ?? ""}
      data-valid={String(item.isValidDrop)}
      data-dragging={String(item.isDragging)}
      style={item.style}
    >
      {item.hasChildren ? (
        <button data-testid={`toggle-${row.id}`} onClick={item.toggle} tabIndex={-1}>
          toggle
        </button>
      ) : null}
      {item.node.name}
    </div>
  );
}

function Rows(): ReactNode {
  const tree = useTree<Item>();
  return (
    <div {...tree.treeProps} data-testid="tree" aria-label="Files">
      {tree.rows.map((row, i) => (
        <Row key={row.id} row={row} top={i * ROW_HEIGHT} />
      ))}
    </div>
  );
}

interface AppProps extends Partial<Omit<TreeDndProps<Item>, "nodes" | "children">> {
  initial?: Item[];
  seen?: { trees: Item[][]; moves: AppliedTreeMove[] };
}

function App({ initial = sample(), seen, onChange, ...rest }: AppProps): ReactNode {
  const [nodes, setNodes] = useState<readonly Item[]>(initial);
  return (
    <TreeDnd<Item>
      animation={{ enabled: false }}
      {...rest}
      nodes={nodes}
      onChange={(next, move) => {
        setNodes(next);
        seen?.trees.push(next as Item[]);
        seen?.moves.push(move);
        onChange?.(next, move);
      }}
    >
      <Rows />
    </TreeDnd>
  );
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element | Document, x: number, y: number): void {
  fireEvent[type](target, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: y });
}

const rowY = (index: number, offset: number): number => index * ROW_HEIGHT + offset;
const rowIds = (): string[] =>
  Array.from(screen.getByTestId("tree").children).map((el) => el.getAttribute("data-testid")?.replace("row-", "") ?? "");

async function dragRow(fromId: string, fromIndex: number, toIndex: number, offset: number): Promise<void> {
  pointer("pointerDown", screen.getByTestId(`row-${fromId}`), 50, rowY(fromIndex, 20));
  pointer("pointerMove", document, 50, rowY(fromIndex, 20) + 6);
  pointer("pointerMove", document, 50, rowY(toIndex, offset));
  await waitFor(() => expect(screen.getByTestId(`row-${rowIds()[toIndex]}`).getAttribute("data-drop")).not.toBe(""));
}

describe("tree semantics", () => {
  it("renders ARIA tree structure with levels, set sizes and expansion state", () => {
    render(<App />);
    expect(screen.getByTestId("tree").getAttribute("role")).toBe("tree");
    const guide = screen.getByTestId("row-guide");
    expect(guide.getAttribute("role")).toBe("treeitem");
    expect(guide.getAttribute("aria-level")).toBe("2");
    expect(guide.getAttribute("aria-posinset")).toBe("1");
    expect(guide.getAttribute("aria-setsize")).toBe("2");
    expect(guide.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("row-readme").hasAttribute("aria-expanded")).toBe(false);
    expect(guide.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByTestId("row-intro").style.getPropertyValue("--gripflow-depth")).toBe("2");
  });

  it("roving tabindex: exactly one row is tabbable", () => {
    render(<App />);
    const tabbable = screen.getAllByRole("treeitem").filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.getAttribute("data-testid")).toBe("row-docs");
  });
});

describe("expansion", () => {
  it("toggles uncontrolled expansion and hides descendants", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("toggle-docs"));
    expect(rowIds()).toEqual(["docs", "src", "index", "readme"]);
    fireEvent.click(screen.getByTestId("toggle-docs"));
    expect(rowIds()).toEqual(["docs", "guide", "intro", "api", "src", "index", "readme"]);
  });

  it("supports controlled expansion", () => {
    const onExpandedChange = vi.fn();
    render(<App expandedIds={new Set(["docs"])} onExpandedChange={onExpandedChange} />);
    expect(rowIds()).toEqual(["docs", "guide", "api", "src", "readme"]);
    fireEvent.click(screen.getByTestId("toggle-src"));
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect([...(onExpandedChange.mock.calls[0]?.[0] as Set<string>)].sort()).toEqual(["docs", "src"]);
    // controlled: the parent did not accept the change, so the rows stay as they are
    expect(rowIds()).toEqual(["docs", "guide", "api", "src", "readme"]);
  });

  it("respects defaultExpandedIds", () => {
    render(<App defaultExpandedIds={new Set()} />);
    expect(rowIds()).toEqual(["docs", "src", "readme"]);
  });

  it("integrates with search results through visibleIds", () => {
    const { visibleIds } = filterTree(sample(), (n) => n.name === "Intro");
    render(<App visibleIds={visibleIds} />);
    expect(rowIds()).toEqual(["docs", "guide", "intro"]);
  });
});

describe("keyboard navigation", () => {
  it("moves focus with arrows, expands and collapses", async () => {
    render(<App />);
    const docs = screen.getByTestId("row-docs");
    docs.focus();
    fireEvent.keyDown(docs, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row-guide")));
    expect(screen.getByTestId("row-guide").getAttribute("tabindex")).toBe("0");
    expect(docs.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(screen.getByTestId("row-guide"), { key: "ArrowLeft" }); // collapse
    expect(rowIds()).toEqual(["docs", "guide", "api", "src", "index", "readme"]);
    fireEvent.keyDown(screen.getByTestId("row-guide"), { key: "ArrowLeft" }); // already collapsed: go to parent
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row-docs")));
    fireEvent.keyDown(screen.getByTestId("row-docs"), { key: "ArrowRight" }); // expanded: enter first child
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row-guide")));
    fireEvent.keyDown(screen.getByTestId("row-guide"), { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row-readme")));
    fireEvent.keyDown(screen.getByTestId("row-readme"), { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row-docs")));
  });
});

describe("Alt+Arrow keyboard fallback", () => {
  it("reorders, indents and outdents without dragging, keeps focus and announces", async () => {
    const seen = { trees: [] as Item[][], moves: [] as AppliedTreeMove[] };
    render(<App seen={seen} />);
    const src = screen.getByTestId("row-src");
    src.focus();
    fireEvent.keyDown(src, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(seen.moves).toHaveLength(1));
    expect(seen.trees[0]?.map((n) => n.id)).toEqual(["src", "docs", "readme"]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row-src")));
    await waitFor(() => expect(liveText()).toMatch(/Src moved up, position 1/));

    fireEvent.keyDown(screen.getByTestId("row-readme"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(seen.moves).toHaveLength(2));
    expect(seen.moves[1]).toMatchObject({ id: "readme", to: { parentId: "docs" } });

    fireEvent.keyDown(screen.getByTestId("row-readme"), { key: "ArrowLeft", altKey: true });
    await waitFor(() => expect(seen.moves).toHaveLength(3));
    expect(seen.moves[2]).toMatchObject({ id: "readme", to: { parentId: null } });
  });

  it("announces instead of moving when a step is impossible, and never changes data", async () => {
    const onChange = vi.fn();
    render(<App onChange={onChange} />);
    fireEvent.keyDown(screen.getByTestId("row-docs"), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(liveText()).toMatch(/first item/i));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses to move locked nodes", async () => {
    const rules: TreeRules<Item> = { isLocked: (n) => !!n.locked };
    const onChange = vi.fn();
    render(<App initial={sample().map((n) => (n.id === "src" ? { ...n, locked: true } : n))} rules={rules} onChange={onChange} />);
    const src = screen.getByTestId("row-src");
    expect(src.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(src, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(liveText()).toMatch(/locked/i));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("pointer drag and drop", () => {
  it("drops inside a folder (middle zone) and expands it", async () => {
    const seen = { trees: [] as Item[][], moves: [] as AppliedTreeMove[] };
    render(<App seen={seen} defaultExpandedIds={new Set(["docs", "guide"])} />);
    // rows: docs0 guide1 intro2 api3 src4 readme5 ; src is collapsed
    await dragRow("readme", 5, 4, 20);
    expect(screen.getByTestId("row-src").getAttribute("data-drop")).toBe("inside");
    pointer("pointerUp", document, 50, rowY(4, 20));
    await waitFor(() => expect(seen.moves).toHaveLength(1));
    expect(seen.moves[0]).toMatchObject({ id: "readme", to: { parentId: "src", index: 1 } });
    await waitFor(() => expect(rowIds()).toContain("readme"));
    // the target folder was expanded so the user can see the result
    expect(rowIds()).toEqual(["docs", "guide", "intro", "api", "src", "index", "readme"]);
  });

  it("drops above and below a row at the right sibling index", async () => {
    const seen = { trees: [] as Item[][], moves: [] as AppliedTreeMove[] };
    render(<App seen={seen} defaultExpandedIds={new Set()} />);
    // rows: docs0 src1 readme2
    await dragRow("readme", 2, 0, 4);
    expect(screen.getByTestId("row-docs").getAttribute("data-drop")).toBe("before");
    pointer("pointerUp", document, 50, rowY(0, 4));
    await waitFor(() => expect(seen.moves).toHaveLength(1));
    expect(seen.trees[0]?.map((n) => n.id)).toEqual(["readme", "docs", "src"]);
  });

  it("rejects dropping a node inside its own descendant, reports why and leaves data untouched", async () => {
    const seen = { trees: [] as Item[][], moves: [] as AppliedTreeMove[] };
    const failures: TreeMoveFailure[] = [];
    render(<App seen={seen} onMoveRejected={(f) => failures.push(f)} />);
    // rows: docs0 guide1 intro2 ...; drag docs onto the middle of intro
    await dragRow("docs", 0, 2, 20);
    const intro = screen.getByTestId("row-intro");
    expect(intro.getAttribute("data-valid")).toBe("false");
    pointer("pointerUp", document, 50, rowY(2, 20));
    await waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0]?.reason).toBe("into-descendant");
    expect(seen.moves).toHaveLength(0);
    expect(rowIds()).toEqual(["docs", "guide", "intro", "api", "src", "index", "readme"]);
  });

  it("never offers 'inside' on rows that cannot contain children", async () => {
    const seen = { trees: [] as Item[][], moves: [] as AppliedTreeMove[] };
    const failures: TreeMoveFailure[] = [];
    const rules: TreeRules<Item> = { acceptsChildren: (n) => !n.leaf };
    render(<App seen={seen} rules={rules} onMoveRejected={(f) => failures.push(f)} defaultExpandedIds={new Set()} />);
    // rows: docs0 src1 readme2. readme is a leaf: dropping docs "inside" readme is refused.
    pointer("pointerDown", screen.getByTestId("row-docs"), 50, rowY(0, 20));
    pointer("pointerMove", document, 50, rowY(0, 28));
    pointer("pointerMove", document, 50, rowY(2, 20));
    // leaf rows use two zones, so the middle of a leaf row is "after", never "inside"
    await waitFor(() => expect(screen.getByTestId("row-readme").getAttribute("data-drop")).toBe("after"));
    pointer("pointerUp", document, 50, rowY(2, 20));
    await waitFor(() => expect(seen.moves).toHaveLength(1));
    expect(seen.trees[0]?.map((n) => n.id)).toEqual(["src", "readme", "docs"]);
    expect(failures).toHaveLength(0);
  });

  it("never starts dragging a locked node", async () => {
    const onChange = vi.fn();
    render(
      <App
        initial={sample().map((n) => (n.id === "readme" ? { ...n, locked: true } : n))}
        rules={{ isLocked: (n) => !!n.locked }}
        onChange={onChange}
        defaultExpandedIds={new Set()}
      />,
    );
    pointer("pointerDown", screen.getByTestId("row-readme"), 50, rowY(2, 20));
    pointer("pointerMove", document, 50, rowY(2, 20) + 10);
    pointer("pointerMove", document, 50, rowY(0, 20));
    expect(screen.getByTestId("row-readme").getAttribute("data-dragging")).toBe("false");
    pointer("pointerUp", document, 50, rowY(0, 20));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not change anything when dropped in its original position", async () => {
    const onChange = vi.fn();
    render(<App onChange={onChange} defaultExpandedIds={new Set()} />);
    // rows: docs0 src1 readme2: dropping src "after" docs is where it already is
    await dragRow("src", 1, 0, 36);
    pointer("pointerUp", document, 50, rowY(0, 36));
    await waitFor(() => expect(liveText()).toMatch(/original position/i));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the dragged tree structure when cancelled with Escape", async () => {
    const onChange = vi.fn();
    render(<App onChange={onChange} defaultExpandedIds={new Set()} />);
    await dragRow("readme", 2, 0, 20);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("row-readme").getAttribute("data-dragging")).toBe("false"));
    expect(onChange).not.toHaveBeenCalled();
    expect(rowIds()).toEqual(["docs", "src", "readme"]);
  });
});

describe("keyboard drag and drop", () => {
  it("picks up with Space, chooses a position with arrows and drops", async () => {
    const seen = { trees: [] as Item[][], moves: [] as AppliedTreeMove[] };
    render(<App seen={seen} />);
    // rows: docs0 guide1 intro2 api3 src4 index5 readme6
    const api = screen.getByTestId("row-api");
    api.focus();
    fireEvent.keyDown(api, { key: " " });
    await waitFor(() => expect(api.getAttribute("data-dragging")).toBe("true"));
    fireEvent.keyDown(api, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByTestId("row-src").getAttribute("data-drop")).toBe("after"));
    fireEvent.keyDown(api, { key: " " });
    await waitFor(() => expect(seen.moves).toHaveLength(1));
    // "after an expanded folder" lands on its first child
    expect(seen.moves[0]).toMatchObject({ id: "api", to: { parentId: "src", index: 0 } });
    const result = seen.trees[0] as Item[];
    expect(findNode(result, "api")?.parentId).toBe("src");
    expect(findNode(result, "docs")?.node.children?.map((c) => c.id)).toEqual(["guide"]);
  });
});

function liveText(): string {
  return Array.from(document.querySelectorAll("[aria-live]"))
    .map((el) => el.textContent ?? "")
    .join(" ");
}
