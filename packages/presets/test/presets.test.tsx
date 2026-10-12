// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SortableGrid, SortableList, SortableTable } from "../src";

interface Task {
  id: string;
  title: string;
  locked?: boolean;
}

const tasks: readonly Task[] = [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Bravo" },
  { id: "c", title: "Charlie" },
];

/** jsdom has no layout: every `data-gripflow-item` is a 200x50 box stacked by DOM order. */
let restore: () => void;
beforeAll(() => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    let left = 0;
    let top = 0;
    let width = 200;
    let height = 50;
    if (this.hasAttribute("data-gripflow-item")) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      top = index * 50;
    } else if (this.hasAttribute("data-gripflow-list")) {
      height = Math.max(50, this.children.length * 50);
    } else {
      width = 0;
      height = 0;
      left = 0;
    }
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
  restore = () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
});
afterAll(() => restore());
afterEach(() => cleanup());

function titles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-gripflow-item]")).map(
    (el) => el.textContent?.replace(/⠿|Reorder row/g, "").trim() ?? "",
  );
}

describe("SortableList", () => {
  it("reorders by keyboard, reports the new array and never mutates the input", async () => {
    const input = tasks.slice();
    const onItemsChange = vi.fn();
    render(
      <SortableList
        items={input}
        getId={(t) => t.id}
        onItemsChange={onItemsChange}
        renderItem={(t) => <span>{t.title}</span>}
        aria-label="Tasks"
      />,
    );
    const first = screen.getAllByRole("button")[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: " " });
    await waitFor(() => expect(first.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(first, { key: " " });
    await waitFor(() => expect(onItemsChange).toHaveBeenCalledTimes(1));
    const [next, move] = onItemsChange.mock.calls[0] as [Task[], { activeId: string }];
    expect(next.map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(move.activeId).toBe("a");
    expect(input.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("is uncontrolled when only defaultItems is given", async () => {
    render(
      <SortableList
        defaultItems={tasks}
        getId={(t) => t.id}
        renderItem={(t) => <span>{t.title}</span>}
      />,
    );
    const list = screen.getByRole("group");
    const first = within(list).getAllByRole("button")[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: " " });
    await waitFor(() => expect(first.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(first, { key: " " });
    await waitFor(() => expect(titles(list)).toEqual(["Bravo", "Alpha", "Charlie"]));
  });

  it("stays controlled: the list does not change until the parent applies the change", async () => {
    render(
      <SortableList
        items={tasks}
        getId={(t) => t.id}
        onItemsChange={() => undefined}
        renderItem={(t) => <span>{t.title}</span>}
      />,
    );
    const list = screen.getByRole("group");
    const first = within(list).getAllByRole("button")[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: " " });
    await waitFor(() => expect(first.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(first, { key: " " });
    await waitFor(() => expect(first.getAttribute("aria-pressed")).toBe("false"));
    expect(titles(list)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("locks disabled items and exposes state as data attributes", () => {
    render(
      <SortableList
        items={[...tasks, { id: "d", title: "Delta", locked: true }]}
        getId={(t) => t.id}
        isItemDisabled={(t) => t.locked === true}
        renderItem={(t) => <span>{t.title}</span>}
      />,
    );
    const items = document.querySelectorAll("[data-gripflow-item]");
    expect(items[3]?.hasAttribute("data-disabled")).toBe(true);
    expect(items[3]?.getAttribute("aria-disabled")).toBe("true");
    expect(items[0]?.hasAttribute("data-disabled")).toBe(false);
  });

  it("renders the empty state and keeps an empty drop container", () => {
    render(
      <SortableList
        items={[] as Task[]}
        getId={(t) => t.id}
        emptyState={<p>Nothing here</p>}
        renderItem={(t) => <span>{t.title}</span>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(document.querySelector("[data-gripflow-list]")?.hasAttribute("data-empty")).toBe(true);
  });

  it("with a handle only the handle is focusable and the item wrapper has no button role", () => {
    render(
      <SortableList
        items={tasks}
        getId={(t) => t.id}
        handle
        renderItem={(t, s) => (
          <>
            <button {...s.handleProps} aria-label={`Move ${t.title}`}>
              grip
            </button>
            <span>{t.title}</span>
          </>
        )}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(document.querySelector("[data-gripflow-item]")?.getAttribute("role")).toBeNull();
    expect(screen.getByLabelText("Move Alpha").hasAttribute("data-gripflow-handle")).toBe(true);
  });

  it("applies custom markup and class names without any stylesheet", () => {
    render(
      <SortableList
        items={tasks}
        getId={(t) => t.id}
        containerAs="ul"
        itemAs="li"
        className="my-list"
        itemClassName={(t) => `row row-${t.id}`}
        renderItem={(t) => t.title}
      />,
    );
    const list = document.querySelector("ul.my-list");
    expect(list).not.toBeNull();
    expect(list?.querySelector("li.row.row-b")).not.toBeNull();
  });

  it("SortableGrid uses the grid layout", () => {
    render(<SortableGrid items={tasks} getId={(t) => t.id} renderItem={(t) => t.title} />);
    expect(document.querySelector("[data-gripflow-list]")?.getAttribute("data-layout")).toBe("grid");
  });

  it("cleans up its engine listeners on unmount", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(
      <SortableList items={tasks} getId={(t) => t.id} renderItem={(t) => t.title} />,
    );
    unmount();
    const added = addSpy.mock.calls.length;
    const removed = removeSpy.mock.calls.length;
    expect(removed).toBeGreaterThanOrEqual(added);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("SortableTable", () => {
  const columns = [
    { key: "title", header: "Title", cell: (t: Task) => t.title },
    { key: "id", header: "ID", cell: (t: Task) => t.id },
  ];

  it("keeps native table semantics and reorders through the handle button", async () => {
    const onRowsChange = vi.fn();
    render(
      <SortableTable
        rows={tasks}
        getRowId={(t) => t.id}
        columns={columns}
        onRowsChange={onRowsChange}
        aria-label="Task table"
      />,
    );
    expect(screen.getByRole("table", { name: "Task table" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    const handles = screen.getAllByRole("button", { name: "Reorder row" });
    expect(handles).toHaveLength(3);
    const handle = handles[0] as HTMLElement;
    handle.focus();
    fireEvent.keyDown(handle, { key: " " });
    await waitFor(() => expect(handle.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: " " });
    await waitFor(() => expect(onRowsChange).toHaveBeenCalledTimes(1));
    const [rows] = onRowsChange.mock.calls[0] as [Task[]];
    expect(rows.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("shows an empty-state row and disables locked rows", () => {
    const { rerender } = render(
      <SortableTable
        rows={[] as Task[]}
        getRowId={(t) => t.id}
        columns={columns}
        emptyState="No rows"
      />,
    );
    expect(screen.getByText("No rows")).toBeTruthy();
    rerender(
      <SortableTable
        rows={[{ id: "z", title: "Zulu", locked: true }]}
        getRowId={(t) => t.id}
        columns={columns}
        isRowDisabled={(t) => t.locked === true}
      />,
    );
    expect(document.querySelector("tr[data-gripflow-item]")?.hasAttribute("data-disabled")).toBe(true);
  });
});
