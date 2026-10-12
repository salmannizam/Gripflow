// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DragEngine, keyboardSensor } from "@gripflow/core";
import { DragDropProvider, DragOverlay, useDragEngine, useDraggable, useDroppable } from "../src";
import {
  Board,
  SortableList,
  createRecorder,
  installRectMock,
  orderOf,
  recorderHandlers,
} from "./fixtures";

let restoreRects: () => void;
beforeAll(() => {
  restoreRects = installRectMock();
});
afterAll(() => restoreRects());
afterEach(() => cleanup());

function pointer(
  type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  target: Element | Document,
  x: number,
  y: number,
): void {
  fireEvent[type](target, {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

async function dragWithPointer(
  from: Element,
  start: [number, number],
  to: [number, number],
): Promise<void> {
  pointer("pointerDown", from, ...start);
  pointer("pointerMove", document, start[0], start[1] + 10);
  pointer("pointerMove", document, ...to);
  await waitFor(() => expect(document.querySelector('[data-over="true"]')).not.toBeNull());
  pointer("pointerUp", document, ...to);
}

describe("pointer sorting", () => {
  it("reorders a controlled list by stable id and reports the move", async () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b", "c"]} rec={rec} />);
    await dragWithPointer(screen.getByTestId("item-a"), [100, 25], [100, 125]);
    await waitFor(() => expect(orderOf(screen.getByTestId("list"))).toEqual(["b", "c", "a"]));
    expect(rec.ends).toHaveLength(1);
    expect(rec.ends[0]?.move).toMatchObject({
      activeId: "a",
      fromContainerId: "list",
      toContainerId: "list",
      fromIndex: 0,
      toIndex: 2,
    });
    expect(rec.log[0]).toBe("start:a");
  });

  it("leaves the consumer's order untouched when the consumer rejects the move", async () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b", "c"]} rec={rec} accept={false} />);
    await dragWithPointer(screen.getByTestId("item-a"), [100, 25], [100, 125]);
    await waitFor(() => expect(rec.ends).toHaveLength(1));
    expect(orderOf(screen.getByTestId("list"))).toEqual(["a", "b", "c"]);
    expect(screen.getByTestId("item-a").getAttribute("style") ?? "").not.toContain("translate");
  });

  it("does not start a drag below the activation distance", () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b"]} rec={rec} />);
    pointer("pointerDown", screen.getByTestId("item-a"), 100, 25);
    pointer("pointerMove", document, 101, 26);
    pointer("pointerUp", document, 101, 26);
    expect(rec.log).toEqual([]);
  });

  it("only starts from the handle when a handle is used", async () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b", "c"]} rec={rec} handle />);
    pointer("pointerDown", screen.getByTestId("item-a"), 100, 25);
    pointer("pointerMove", document, 100, 90);
    expect(rec.log).toEqual([]);
    pointer("pointerUp", document, 100, 90);

    pointer("pointerDown", screen.getByTestId("handle-a"), 100, 25);
    pointer("pointerMove", document, 100, 40);
    await waitFor(() => expect(rec.log).toContain("start:a"));
    pointer("pointerUp", document, 100, 40);
  });

  it("does not start a drag from an interactive child", () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b"]} rec={rec} withButton />);
    pointer("pointerDown", screen.getByTestId("button-a"), 100, 25);
    pointer("pointerMove", document, 100, 90);
    expect(rec.log).toEqual([]);
    pointer("pointerUp", document, 100, 90);
  });

  it("never starts a drag from a disabled item", () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b"]} rec={rec} disabledIds={["a"]} />);
    const a = screen.getByTestId("item-a");
    expect(a.getAttribute("aria-disabled")).toBe("true");
    pointer("pointerDown", a, 100, 25);
    pointer("pointerMove", document, 100, 90);
    expect(rec.log).toEqual([]);
    pointer("pointerUp", document, 100, 90);
  });

  it("cancels a pointer drag with Escape and restores the layout", async () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b", "c"]} rec={rec} />);
    const a = screen.getByTestId("item-a");
    pointer("pointerDown", a, 100, 25);
    pointer("pointerMove", document, 100, 40);
    pointer("pointerMove", document, 100, 125);
    await waitFor(() => expect(a.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(a.getAttribute("aria-pressed")).toBe("false"));
    expect(rec.cancels.map((c) => c.reason)).toEqual(["escape"]);
    expect(rec.ends).toHaveLength(0);
    expect(orderOf(screen.getByTestId("list"))).toEqual(["a", "b", "c"]);
  });
});

describe("keyboard sorting", () => {
  it("picks up with Space, moves with arrows and drops with Space", async () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b", "c"]} rec={rec} />);
    const a = screen.getByTestId("item-a");
    a.focus();
    fireEvent.keyDown(a, { key: " " });
    await waitFor(() => expect(a.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.keyDown(a, { key: "ArrowDown" });
    await waitFor(() => expect(rec.log).toContain("over:b"));
    fireEvent.keyDown(a, { key: " " });
    await waitFor(() => expect(orderOf(screen.getByTestId("list"))).toEqual(["b", "a", "c"]));
    expect(rec.ends[0]?.move?.toIndex).toBe(1);
  });

  it("cancels with Escape without changing the order", async () => {
    const rec = createRecorder();
    render(<SortableList initial={["a", "b", "c"]} rec={rec} />);
    const a = screen.getByTestId("item-a");
    a.focus();
    fireEvent.keyDown(a, { key: " " });
    fireEvent.keyDown(a, { key: "ArrowDown" });
    fireEvent.keyDown(a, { key: "Escape" });
    await waitFor(() => expect(rec.cancels.map((c) => c.reason)).toEqual(["escape"]));
    expect(orderOf(screen.getByTestId("list"))).toEqual(["a", "b", "c"]);
  });

  it("exposes drag semantics for assistive technology", () => {
    render(<SortableList initial={["a"]} />);
    const a = screen.getByTestId("item-a");
    expect(a.getAttribute("role")).toBe("button");
    expect(a.getAttribute("aria-roledescription")).toBe("sortable");
    const describedBy = a.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(/space/i);
  });

  it("announces drag start and cancellation in a live region", async () => {
    render(
      <DragDropProvider animation={{ enabled: false }}>
        <Draggable id="a" testId="announce-a" />
      </DragDropProvider>,
    );
    const a = screen.getByTestId("announce-a");
    a.focus();
    fireEvent.keyDown(a, { key: " " });
    await waitFor(() => expect(liveRegionText()).toMatch(/picked up card a/i));
    fireEvent.keyDown(a, { key: "Escape" });
    await waitFor(() => expect(liveRegionText()).toMatch(/cancelled/i));
  });
});

function liveRegionText(): string {
  return Array.from(document.querySelectorAll("[aria-live]"))
    .map((el) => el.textContent ?? "")
    .join(" ");
}

function Draggable({ id, testId, disabled }: { id: string; testId: string; disabled?: boolean }) {
  const d = useDraggable({ id, data: { label: `Card ${id}` }, disabled });
  return (
    <div ref={d.setNodeRef} data-testid={testId} data-rect="0,0,100,50" style={d.style} {...d.attributes}>
      {id}
    </div>
  );
}

describe("cross-container", () => {
  it("moves a card into an empty container", async () => {
    const rec = createRecorder();
    render(<Board initial={{ todo: ["a", "b"], done: [] }} rec={rec} />);
    pointer("pointerDown", screen.getByTestId("item-a"), 100, 25);
    pointer("pointerMove", document, 100, 40);
    pointer("pointerMove", document, 400, 40);
    await waitFor(() => expect(screen.getByTestId("column-done").getAttribute("data-over")).toBe("true"));
    expect(screen.getByTestId("column-done").getAttribute("data-drop-target")).toBe("true");
    pointer("pointerUp", document, 400, 40);
    await waitFor(() => expect(rec.ends).toHaveLength(1));
    expect(rec.ends[0]?.move).toMatchObject({
      activeId: "a",
      fromContainerId: "todo",
      toContainerId: "done",
      toIndex: 0,
    });
    await waitFor(() => {
      expect(orderOf(screen.getByTestId("column-todo"))).toEqual(["b"]);
      expect(orderOf(screen.getByTestId("column-done"))).toEqual(["a"]);
    });
  });

  it("inserts at the hovered position inside a populated container", async () => {
    const rec = createRecorder();
    render(<Board initial={{ todo: ["a"], done: ["x", "y"] }} rec={rec} />);
    pointer("pointerDown", screen.getByTestId("item-a"), 100, 25);
    pointer("pointerMove", document, 100, 40);
    pointer("pointerMove", document, 400, 60);
    await waitFor(() => expect(screen.getByTestId("item-y").getAttribute("data-over")).toBe("true"));
    pointer("pointerUp", document, 400, 60);
    await waitFor(() => expect(orderOf(screen.getByTestId("column-done"))).toContain("a"));
    expect(orderOf(screen.getByTestId("column-todo"))).toEqual([]);
  });
});

describe("lifecycle and cleanup", () => {
  it("works under React Strict Mode without duplicate registrations", async () => {
    const rec = createRecorder();
    render(
      <StrictMode>
        <SortableList initial={["a", "b", "c"]} rec={rec} />
      </StrictMode>,
    );
    await dragWithPointer(screen.getByTestId("item-a"), [100, 25], [100, 75]);
    await waitFor(() => expect(orderOf(screen.getByTestId("list"))).toEqual(["b", "a", "c"]));
    expect(rec.ends).toHaveLength(1);
  });

  it("cancels the drag when the dragged item unmounts", async () => {
    const rec = createRecorder();
    function Harness({ show }: { show: boolean }) {
      return (
        <DragDropProvider animation={{ enabled: false }} {...recorderHandlers(rec)}>
          {show ? <Draggable id="a" testId="a" /> : null}
          <Droppable id="zone" />
        </DragDropProvider>
      );
    }
    const { rerender } = render(<Harness show />);
    pointer("pointerDown", screen.getByTestId("a"), 10, 10);
    pointer("pointerMove", document, 20, 20);
    pointer("pointerMove", document, 250, 20);
    await waitFor(() => expect(rec.log).toContain("start:a"));
    rerender(<Harness show={false} />);
    await waitFor(() => expect(rec.cancels.map((c) => c.reason)).toEqual(["source-removed"]));
  });

  it("removes every document/window listener it added when unmounted mid-drag", async () => {
    type Call = [type: string, listener: unknown];
    const calls = { added: [] as Call[], removed: [] as Call[] };
    const track = (target: Document | Window) => {
      const add = vi.spyOn(target, "addEventListener");
      const remove = vi.spyOn(target, "removeEventListener");
      return () => {
        for (const c of add.mock.calls) calls.added.push([c[0], c[1]]);
        for (const c of remove.mock.calls) calls.removed.push([c[0], c[1]]);
        add.mockRestore();
        remove.mockRestore();
      };
    };
    const stopDocument = track(document);
    const stopWindow = track(window);
    const rec = createRecorder();
    const view = render(
      <StrictMode>
        <SortableList initial={["a", "b"]} rec={rec} />
      </StrictMode>,
    );
    pointer("pointerDown", screen.getByTestId("item-a"), 10, 10);
    pointer("pointerMove", document, 10, 80);
    await waitFor(() => expect(rec.log).toContain("start:a"));
    view.unmount();
    await waitFor(() => expect(rec.cancels).toHaveLength(1));
    stopDocument();
    stopWindow();
    const gripflowTypes = new Set([
      "pointermove",
      "pointerup",
      "pointercancel",
      "pointerdown",
      "keydown",
      "contextmenu",
      "selectstart",
      "touchmove",
      "blur",
      "scroll",
      "resize",
    ]);
    const leaked = calls.added.filter(
      ([type, listener]) =>
        gripflowTypes.has(type) && !calls.removed.some(([t, l]) => t === type && l === listener),
    );
    expect(leaked.map(([type]) => type)).toEqual([]);
    expect(document.querySelectorAll("[data-gripflow-live-region]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-gripflow-instructions]")).toHaveLength(0);
  });

  it("throws a descriptive error when a hook is used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Naked() {
      useDraggable({ id: "x" });
      return null;
    }
    expect(() => render(<Naked />)).toThrow(/DragDropProvider/);
    spy.mockRestore();
  });

  it("isolates errors thrown by consumer callbacks", async () => {
    const onError = vi.fn();
    const rec = createRecorder();
    render(
      <SortableList
        initial={["a", "b"]}
        rec={rec}
        onError={onError}
        onDragOver={() => {
          throw new Error("boom");
        }}
      />,
    );
    await dragWithPointer(screen.getByTestId("item-a"), [100, 25], [100, 75]).catch(() => undefined);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[0].phase).toMatch(/onDragOver|dragOver/);
  });
});

function Droppable({ id }: { id: string }) {
  const d = useDroppable({ id });
  return <div ref={d.setNodeRef} data-rect="200,0,100,100" data-over={d.isOver} data-invalid={d.isInvalidOver} />;
}

describe("droppable feedback and validation", () => {
  it("flags a visible-but-forbidden target as invalid and rejects the drop", async () => {
    const rejected = vi.fn();
    function App() {
      return (
        <DragDropProvider
          animation={{ enabled: false }}
          canDrop={({ over }) => (over?.id === "zone" ? { ok: false, reason: "locked" } : true)}
          onDropRejected={rejected}
        >
          <Draggable id="a" testId="a" />
          <ZoneProbe />
        </DragDropProvider>
      );
    }
    render(<App />);
    pointer("pointerDown", screen.getByTestId("a"), 10, 10);
    pointer("pointerMove", document, 20, 20);
    pointer("pointerMove", document, 250, 50);
    await waitFor(() => expect(screen.getByTestId("zone").getAttribute("data-invalid")).toBe("true"));
    expect(screen.getByTestId("zone").getAttribute("data-reason")).toBe("locked");
    pointer("pointerUp", document, 250, 50);
    await waitFor(() => expect(rejected).toHaveBeenCalledTimes(1));
    expect(rejected.mock.calls[0]?.[0].reason).toBe("locked");
  });

  it("supports async validation before committing", async () => {
    const ends = vi.fn();
    const cancels: string[] = [];
    render(
      <DragDropProvider
        animation={{ enabled: false }}
        validateDrop={async () => {
          await Promise.resolve();
          return { ok: false, reason: "server says no" };
        }}
        onDragEnd={ends}
        onDragCancel={(e) => cancels.push(e.reason)}
      >
        <Draggable id="a" testId="a" />
        <ZoneProbe />
      </DragDropProvider>,
    );
    pointer("pointerDown", screen.getByTestId("a"), 10, 10);
    pointer("pointerMove", document, 20, 20);
    pointer("pointerMove", document, 250, 50);
    await waitFor(() => expect(screen.getByTestId("zone").getAttribute("data-over")).toBe("true"));
    pointer("pointerUp", document, 250, 50);
    await waitFor(() => expect(cancels).toEqual(["rejected"]));
    expect(ends).not.toHaveBeenCalled();
  });
});

function ZoneProbe() {
  const d = useDroppable({ id: "zone" });
  return (
    <div
      ref={d.setNodeRef}
      data-testid="zone"
      data-rect="200,0,100,100"
      data-over={d.isOver}
      data-invalid={d.isInvalidOver}
      data-reason={d.rejectionReason ?? ""}
    />
  );
}

describe("DragOverlay", () => {
  it("renders the preview in a portal while dragging and removes it afterwards", async () => {
    function App() {
      return (
        <DragDropProvider animation={{ enabled: false }}>
          <Draggable id="a" testId="a" />
          <ZoneProbe />
          <DragOverlay>{(active) => <div data-testid="preview">Preview {String(active.id)}</div>}</DragOverlay>
        </DragDropProvider>
      );
    }
    render(<App />);
    expect(screen.queryByTestId("preview")).toBeNull();
    pointer("pointerDown", screen.getByTestId("a"), 10, 10);
    pointer("pointerMove", document, 20, 20);
    pointer("pointerMove", document, 250, 50);
    const preview = await screen.findByTestId("preview");
    expect(preview.closest("[data-gripflow-overlay]")?.parentElement).toBe(document.body);
    expect(preview.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
    // The in-flow item no longer receives the drag transform while an overlay is mounted.
    expect(screen.getByTestId("a").getAttribute("style") ?? "").not.toContain("translate");
    pointer("pointerUp", document, 250, 50);
    await waitFor(() => expect(screen.queryByTestId("preview")).toBeNull());
  });

  it("follows the pointer by writing the transform to the DOM", async () => {
    render(
      <DragDropProvider animation={{ enabled: false }}>
        <Draggable id="a" testId="a" />
        <DragOverlay>
          <div>ghost</div>
        </DragOverlay>
      </DragDropProvider>,
    );
    pointer("pointerDown", screen.getByTestId("a"), 10, 10);
    pointer("pointerMove", document, 20, 20);
    await waitFor(() => expect(document.querySelector("[data-gripflow-overlay]")).not.toBeNull());
    pointer("pointerMove", document, 60, 90);
    await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-gripflow-overlay]");
      expect(el?.style.transform).toBe("translate3d(50px, 80px, 0)");
    });
    pointer("pointerUp", document, 60, 90);
  });
});

describe("engine access", () => {
  it("exposes the engine so consumers can subscribe to events and drive it", async () => {
    let engine: DragEngine | undefined;
    function Grab() {
      engine = useDragEngine();
      return null;
    }
    render(
      <DragDropProvider>
        <Grab />
        <Draggable id="a" testId="a" />
      </DragDropProvider>,
    );
    expect(engine).toBeInstanceOf(DragEngine);
    const starts: string[] = [];
    const off = engine?.on("dragStart", (e) => starts.push(String(e.active.id)));
    const a = screen.getByTestId("a");
    a.focus();
    fireEvent.keyDown(a, { key: " " });
    await waitFor(() => expect(starts).toEqual(["a"]));
    off?.();
    act(() => engine?.cancel());
  });

  it("accepts custom sensors through the provider", async () => {
    const onDragStart = vi.fn();
    render(
      <DragDropProvider sensors={[keyboardSensor({ startKeys: ["F2"] })]} onDragStart={onDragStart}>
        <Draggable id="a" testId="a" />
      </DragDropProvider>,
    );
    const a = screen.getByTestId("a");
    a.focus();
    fireEvent.keyDown(a, { key: " " });
    expect(onDragStart).not.toHaveBeenCalled();
    fireEvent.keyDown(a, { key: "F2" });
    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));
  });
});
