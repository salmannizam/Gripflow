// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BoardChange, KanbanRules } from "../src";
import {
  KanbanBoard,
  useOptimisticBoard,
  type BoardMoveFailure,
  type KanbanBoardProps,
} from "../src/react";

interface Card {
  id: string;
  title: string;
  locked?: boolean;
}
interface Column {
  id: string;
  title: string;
  cards: Card[];
  locked?: boolean;
}

const initialBoard = (): Column[] => [
  { id: "todo", title: "To do", cards: [{ id: "a", title: "Write docs" }, { id: "b", title: "Fix bug" }] },
  { id: "doing", title: "Doing", cards: [{ id: "d", title: "Review" }] },
  { id: "done", title: "Done", cards: [] },
];

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

const COLUMN_WIDTH = 250;
const COLUMN_STEP = 300;
const columnLeft = (i: number): number => i * COLUMN_STEP;
const cardTop = (i: number): number => 40 + i * 60;

type BoardProps = Omit<KanbanBoardProps<Column>, "columns" | "renderColumn" | "renderCard" | "onChange"> & {
  columns: readonly Column[];
  onChange?: KanbanBoardProps<Column>["onChange"];
};

function TestBoard({ columns, ...rest }: BoardProps): ReactNode {
  return (
    <KanbanBoard<Column>
      animation={{ enabled: false }}
      {...rest}
      columns={columns}
      renderColumn={(state, cards) => (
        <section
          ref={state.setNodeRef}
          data-testid={`col-${state.column.id}`}
          data-rect={`${columnLeft(state.index)},0,${COLUMN_WIDTH},600`}
          data-over={String(state.isOver)}
          data-target={String(state.isDropTarget)}
          data-invalid={String(state.isInvalidOver)}
          data-reason={state.rejectionReason ?? ""}
          data-dragging={String(state.isDragging)}
          style={state.style}
        >
          <h3 ref={state.setHandleRef} {...state.handleAttributes} data-testid={`handle-${state.column.id}`} data-rect={`${columnLeft(state.index)},0,${COLUMN_WIDTH},30`}>
            {state.column.title} ({state.cardCount})
          </h3>
          <div>{cards}</div>
        </section>
      )}
      renderCard={(card, s, column) => {
        const columnIndex = columns.findIndex((c) => c.id === column.id);
        return (
          <div
            ref={s.setNodeRef}
            {...s.attributes}
            data-testid={`card-${card.id}`}
            data-rect={`${columnLeft(columnIndex)},${cardTop(s.index)},${COLUMN_WIDTH},50`}
            data-dragging={String(s.isDragging)}
            data-over={String(s.isOver)}
            style={s.style}
          >
            {card.title}
          </div>
        );
      }}
    />
  );
}

function Controlled({
  initial = initialBoard(),
  seen,
  ...rest
}: Partial<BoardProps> & { initial?: Column[]; seen?: BoardChange[] }): ReactNode {
  const [columns, setColumns] = useState<readonly Column[]>(initial);
  return (
    <TestBoard
      {...rest}
      columns={columns}
      onChange={(next, change) => {
        setColumns(next);
        seen?.push(change);
        rest.onChange?.(next, change);
      }}
    />
  );
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element | Document, x: number, y: number): void {
  fireEvent[type](target, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: y });
}

const cardsIn = (columnId: string): string[] =>
  Array.from(screen.getByTestId(`col-${columnId}`).querySelectorAll("[data-testid^='card-']")).map(
    (el) => el.getAttribute("data-testid")?.replace("card-", "") ?? "",
  );
const columnOrder = (): string[] =>
  Array.from(document.querySelectorAll("section[data-testid^='col-']")).map(
    (el) => el.getAttribute("data-testid")?.replace("col-", "") ?? "",
  );

function liveText(): string {
  return Array.from(document.querySelectorAll("[aria-live]"))
    .map((el) => el.textContent ?? "")
    .join(" ");
}

describe("cards between columns (pointer)", () => {
  it("moves a card into another column at the hovered position", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 110, cardTop(0) + 40);
    pointer("pointerMove", document, 400, cardTop(0) + 25); // over card d in "doing"
    await waitFor(() => expect(screen.getByTestId("col-doing").getAttribute("data-target")).toBe("true"));
    pointer("pointerUp", document, 400, cardTop(0) + 25);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ type: "card", cardId: "a", from: { columnId: "todo", index: 0 }, to: { columnId: "doing" } });
    await waitFor(() => expect(cardsIn("todo")).toEqual(["b"]));
    expect(cardsIn("doing").sort()).toEqual(["a", "d"]);
  });

  it("drops into an empty column", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    pointer("pointerDown", screen.getByTestId("card-b"), 100, cardTop(1) + 25);
    pointer("pointerMove", document, 110, cardTop(1) + 40);
    pointer("pointerMove", document, 700, 300);
    await waitFor(() => expect(screen.getByTestId("col-done").getAttribute("data-over")).toBe("true"));
    pointer("pointerUp", document, 700, 300);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ cardId: "b", to: { columnId: "done", index: 0 } });
    await waitFor(() => expect(cardsIn("done")).toEqual(["b"]));
    expect(cardsIn("todo")).toEqual(["a"]);
  });

  it("reorders inside a column", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 100, cardTop(0) + 40);
    pointer("pointerMove", document, 100, cardTop(1) + 40);
    await waitFor(() => expect(screen.getByTestId("card-b").getAttribute("data-over")).toBe("true"));
    pointer("pointerUp", document, 100, cardTop(1) + 40);
    await waitFor(() => expect(cardsIn("todo")).toEqual(["b", "a"]));
    expect(seen[0]).toMatchObject({ from: { columnId: "todo", index: 0 }, to: { columnId: "todo", index: 1 } });
  });

  it("cancels cleanly with Escape: no change, nothing left dragging", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 110, cardTop(0) + 40);
    pointer("pointerMove", document, 700, 300);
    await waitFor(() => expect(screen.getByTestId("col-done").getAttribute("data-over")).toBe("true"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("card-a").getAttribute("data-dragging")).toBe("false"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("col-done").getAttribute("data-over")).toBe("false");
    expect(cardsIn("todo")).toEqual(["a", "b"]);
  });
});

describe("rules and invalid drops", () => {
  const wip: KanbanRules<Column> = { maxCards: (c) => (c.id === "doing" ? 1 : undefined) };

  it("shows a non-colour invalid state and refuses the drop when a WIP limit is hit", async () => {
    const failures: BoardMoveFailure[] = [];
    const onChange = vi.fn();
    render(<Controlled rules={wip} onChange={onChange} onMoveRejected={(f) => failures.push(f)} />);
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 110, cardTop(0) + 40);
    pointer("pointerMove", document, 400, cardTop(0) + 25);
    await waitFor(() => expect(screen.getByTestId("col-doing").getAttribute("data-invalid")).toBe("true"));
    expect(screen.getByTestId("col-doing").getAttribute("data-reason")).toMatch(/limited to 1 card/);
    pointer("pointerUp", document, 400, cardTop(0) + 25);
    await waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0]?.reason).toBe("limit-reached");
    expect(onChange).not.toHaveBeenCalled();
    expect(cardsIn("todo")).toEqual(["a", "b"]);
  });

  it("enforces workflow transitions", async () => {
    const failures: BoardMoveFailure[] = [];
    render(
      <Controlled
        rules={{ transitions: { todo: ["doing"] } }}
        onMoveRejected={(f) => failures.push(f)}
      />,
    );
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 110, cardTop(0) + 40);
    pointer("pointerMove", document, 700, 300);
    await waitFor(() => expect(screen.getByTestId("col-done").getAttribute("data-invalid")).toBe("true"));
    pointer("pointerUp", document, 700, 300);
    await waitFor(() => expect(failures[0]?.reason).toBe("transition-not-allowed"));
    expect(cardsIn("done")).toEqual([]);
  });

  it("never drags a locked card", () => {
    const onChange = vi.fn();
    const board = initialBoard();
    (board[0] as Column).cards[0] = { id: "a", title: "Locked", locked: true };
    render(<Controlled initial={board} rules={{ isCardLocked: (c) => !!c.locked }} onChange={onChange} />);
    expect(screen.getByTestId("card-a").getAttribute("aria-disabled")).toBe("true");
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 110, cardTop(0) + 40);
    pointer("pointerMove", document, 700, 300);
    pointer("pointerUp", document, 700, 300);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("column ordering", () => {
  it("reorders columns by dragging the column handle", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    pointer("pointerDown", screen.getByTestId("handle-todo"), 100, 10);
    pointer("pointerMove", document, 110, 14);
    pointer("pointerMove", document, 400, 14); // over the "doing" column
    await waitFor(() => expect(screen.getByTestId("col-todo").getAttribute("data-dragging")).toBe("true"));
    pointer("pointerUp", document, 400, 14);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ type: "column", columnId: "todo", from: 0, to: 1 });
    await waitFor(() => expect(columnOrder()).toEqual(["doing", "todo", "done"]));
    // cards travel with their column
    expect(cardsIn("todo")).toEqual(["a", "b"]);
  });

  it("does not drag locked columns", () => {
    const onChange = vi.fn();
    const board = initialBoard().map((c) => (c.id === "todo" ? { ...c, locked: true } : c));
    render(<Controlled initial={board} rules={{ isColumnLocked: (c) => !!c.locked }} onChange={onChange} />);
    expect(screen.getByTestId("handle-todo").getAttribute("aria-disabled")).toBe("true");
    pointer("pointerDown", screen.getByTestId("handle-todo"), 100, 10);
    pointer("pointerMove", document, 110, 14);
    pointer("pointerMove", document, 400, 14);
    pointer("pointerUp", document, 400, 14);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("keyboard operation", () => {
  it("moves a card to the neighbouring column with Alt+ArrowRight, keeps focus and announces", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    const card = screen.getByTestId("card-a");
    card.focus();
    fireEvent.keyDown(card, { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ cardId: "a", to: { columnId: "doing" } });
    await waitFor(() => expect(cardsIn("doing")).toContain("a"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("card-a")));
    await waitFor(() => expect(liveText()).toMatch(/Write docs moved to position \d in Doing/));
  });

  it("reorders inside a column with Alt+ArrowDown and refuses past the end", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    fireEvent.keyDown(screen.getByTestId("card-a"), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(cardsIn("todo")).toEqual(["b", "a"]));
    fireEvent.keyDown(screen.getByTestId("card-a"), { key: "ArrowDown", altKey: true });
    expect(seen).toHaveLength(1);
  });

  it("respects rules for keyboard moves and tells the user why", async () => {
    const failures: BoardMoveFailure[] = [];
    render(<Controlled rules={wipRules} onMoveRejected={(f) => failures.push(f)} />);
    fireEvent.keyDown(screen.getByTestId("card-a"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(liveText()).toMatch(/limited to 1 card/));
    expect(failures[0]?.reason).toBe("limit-reached");
    expect(cardsIn("todo")).toEqual(["a", "b"]);
  });

  it("drags with Space and the arrow keys across columns", async () => {
    const seen: BoardChange[] = [];
    render(<Controlled seen={seen} />);
    const card = screen.getByTestId("card-a");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    await waitFor(() => expect(card.getAttribute("data-dragging")).toBe("true"));
    fireEvent.keyDown(card, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("col-doing").getAttribute("data-target")).toBe("true"));
    fireEvent.keyDown(card, { key: " " });
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ cardId: "a", to: { columnId: "doing" } });
  });

  it("announces with column titles instead of internal ids", async () => {
    render(<Controlled />);
    const card = screen.getByTestId("card-a");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    await waitFor(() => expect(card.getAttribute("data-dragging")).toBe("true"));
    // The live region keeps only the latest message; titles (not internal ids) must appear.
    await waitFor(() => expect(liveText()).toMatch(/Write docs/));
    fireEvent.keyDown(card, { key: "ArrowRight" });
    await waitFor(() => expect(liveText()).toMatch(/in Doing/));
    expect(liveText()).not.toMatch(/gripflow-kanban/);
    fireEvent.keyDown(card, { key: "Escape" });
  });
});

const wipRules: KanbanRules<Column> = { maxCards: (c) => (c.id === "doing" ? 1 : undefined) };

describe("optimistic updates with rollback", () => {
  function OptimisticApp({
    persist,
    onRejected,
  }: {
    persist: (change: BoardChange, columns: readonly Column[]) => Promise<readonly Column[] | void>;
    onRejected?: () => void;
  }): ReactNode {
    const board = useOptimisticBoard<Column>(initialBoard(), {
      persist: ({ change, columns }) => persist(change, columns),
      onRejected,
    });
    return (
      <>
        <TestBoard columns={board.columns} onChange={board.onChange} />
        <output data-testid="pending">{board.pending}</output>
        <output data-testid="rejection">{board.rejection ? board.rejection.change.type : ""}</output>
      </>
    );
  }

  it("applies the move immediately and keeps it once the server confirms", async () => {
    let resolve: () => void = () => undefined;
    const persist = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<OptimisticApp persist={persist} />);
    fireEvent.keyDown(screen.getByTestId("card-a"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(cardsIn("doing")).toContain("a")); // immediate
    expect(screen.getByTestId("pending").textContent).toBe("1");
    resolve();
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(cardsIn("doing")).toContain("a");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("rolls back to the confirmed board when the server rejects the change", async () => {
    const onRejected = vi.fn();
    const persist = vi.fn(() => Promise.reject(new Error("403 forbidden")));
    render(<OptimisticApp persist={persist} onRejected={onRejected} />);
    fireEvent.keyDown(screen.getByTestId("card-a"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(onRejected).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(cardsIn("todo")).toEqual(["a", "b"]));
    expect(cardsIn("doing")).toEqual(["d"]);
    expect(screen.getByTestId("rejection").textContent).toBe("card");
    expect(String(onRejected.mock.calls[0]?.[0].error)).toMatch(/403/);
  });

  it("adopts the canonical board returned by the server", async () => {
    const canonical: Column[] = [
      { id: "todo", title: "To do", cards: [{ id: "b", title: "Fix bug" }] },
      { id: "doing", title: "Doing", cards: [{ id: "a", title: "Write docs" }, { id: "d", title: "Review" }] },
      { id: "done", title: "Done", cards: [] },
    ];
    render(<OptimisticApp persist={async () => canonical} />);
    fireEvent.keyDown(screen.getByTestId("card-a"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(cardsIn("doing")).toEqual(["a", "d"]); // the server put it first, not where the client guessed
  });
});

describe("board changes while dragging", () => {
  it("cancels the drag if the dragged card is deleted by the application", async () => {
    const onChange = vi.fn();
    function Host({ columns }: { columns: Column[] }): ReactNode {
      return <TestBoard columns={columns} onChange={onChange} />;
    }
    const { rerender } = render(<Host columns={initialBoard()} />);
    pointer("pointerDown", screen.getByTestId("card-a"), 100, cardTop(0) + 25);
    pointer("pointerMove", document, 110, cardTop(0) + 40);
    pointer("pointerMove", document, 400, cardTop(0) + 25);
    await waitFor(() => expect(screen.getByTestId("card-a").getAttribute("data-dragging")).toBe("true"));
    rerender(<Host columns={initialBoard().map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== "a") }))} />);
    await waitFor(() => expect(screen.queryByTestId("card-a")).toBeNull());
    pointer("pointerUp", document, 400, cardTop(0) + 25);
    expect(onChange).not.toHaveBeenCalled();
    expect(cardsIn("todo")).toEqual(["b"]);
  });
});
