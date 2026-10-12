import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  composeDetectors,
  containerAware,
  closestCenter,
  defaultGetLabel,
  filterDroppables,
  pointerWithin,
  type ActiveInfo,
  type CollisionDetector,
  type DragEndEvent,
  type DragEngine,
  type DragData,
  type SortableMove,
  type UniqueId,
} from "@gripflow/core";
import {
  DragDropProvider,
  DragOverlay,
  SortableContext,
  useDragEngine,
  useIsomorphicLayoutEffect,
  useSortable,
  useSortableContainer,
  type DragDropProviderProps,
  type UseSortableReturn,
} from "@gripflow/react";
import {
  canMoveCard,
  canMoveColumn,
  findCard,
  findColumn,
  moveCard,
  moveColumn,
} from "../board";
import type {
  BoardChange,
  BoardErrorCode,
  CardMove,
  CardOf,
  ColumnMove,
  KanbanColumnShape,
  KanbanRules,
} from "../types";

/** Engine ids are namespaced so a column and its card list never collide with card ids. */
const COLUMNS_CONTAINER = "gripflow-kanban:columns";
const columnItemId = (columnId: UniqueId): string => `gripflow-kanban:column:${columnId}`;
const cardsContainerId = (columnId: UniqueId): string => `gripflow-kanban:cards:${columnId}`;

export interface BoardMoveFailure {
  readonly reason: BoardErrorCode;
  readonly message: string;
}

export interface KanbanDndProps<Col extends KanbanColumnShape>
  extends Omit<DragDropProviderProps, "children"> {
  /** The board. You own it: `onChange` hands you the next version, nothing is mutated. */
  columns: readonly Col[];
  /** Called with the next board after an accepted drop or keyboard move. */
  onChange?: (columns: readonly Col[], change: BoardChange) => void;
  /** Move restrictions: locked cards/columns, WIP limits, workflow transitions, custom checks. */
  rules?: KanbanRules<Col>;
  /** Spoken name of a column. Default: `title`, `name` or `label` field, else the id. */
  getColumnLabel?: (column: Col) => string;
  /** Spoken name of a card. Default: `title`, `name` or `label` field, else the id. */
  getCardLabel?: (card: CardOf<Col>) => string;
  /** A drop or keyboard move was refused by the rules. */
  onMoveRejected?: (failure: BoardMoveFailure, attempted: CardMove | ColumnMove | null) => void;
  children?: ReactNode;
}

function labelFrom(value: unknown, id: UniqueId): string {
  if (typeof value === "object" && value !== null) {
    for (const key of ["title", "name", "label"] as const) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
  }
  return String(id);
}

interface KanbanInternals {
  readonly engine: DragEngine;
  readonly columns: readonly KanbanColumnShape[];
  readonly rules: KanbanRules<KanbanColumnShape>;
  readonly cardLabel: (card: { readonly id: UniqueId }) => string;
  readonly columnLabel: (column: KanbanColumnShape) => string;
  step(cardId: UniqueId, direction: "up" | "down" | "left" | "right"): boolean;
}

const KanbanContext = createContext<KanbanInternals | null>(null);

function useKanban(hookName: string): KanbanInternals {
  const value = useContext(KanbanContext);
  if (!value) {
    throw new Error(
      `[gripflow/kanban] ${hookName} must be used inside <KanbanDnd>. Wrap your board with <KanbanDnd columns={...}>.`,
    );
  }
  return value;
}

interface Bridge {
  isColumnDrag(activeId: UniqueId): boolean;
  describeContainer(id: UniqueId): string | undefined;
  judge(move: SortableMove | null): { ok: boolean; reason?: string };
  commit(event: DragEndEvent): void;
  rejected(move: SortableMove | null): void;
}

/**
 * Kanban board behaviour on top of the shared engine: sortable cards in sortable columns,
 * cross-column moves, empty columns, rules, announcements and keyboard fallbacks. It owns no
 * markup: render columns with `<KanbanColumn>` and cards with `useKanbanCard`.
 */
export function KanbanDnd<Col extends KanbanColumnShape>(props: KanbanDndProps<Col>): ReactNode {
  const {
    columns,
    onChange,
    rules,
    getColumnLabel,
    getCardLabel,
    onMoveRejected,
    children,
    accessibility,
    collisionDetection,
    canDrop,
    onDragEnd,
    onDropRejected,
    ...provider
  } = props;
  const bridge = useRef<Bridge | null>(null);

  const detector = useMemo<CollisionDetector>(() => {
    const cards = containerAware();
    const columnsOnly = composeDetectors(pointerWithin, closestCenter);
    return (args) => {
      const isColumn = bridge.current?.isColumnDrag(args.activeId) ?? false;
      return isColumn
        ? filterDroppables(columnsOnly, (d) => d.containerId === COLUMNS_CONTAINER)(args)
        : filterDroppables(cards, (d) => d.containerId !== COLUMNS_CONTAINER)(args);
    };
  }, []);

  const getLabel = useMemo(
    () => (id: UniqueId, data?: DragData) =>
      accessibility?.getLabel?.(id, data) ?? bridge.current?.describeContainer(id) ?? defaultGetLabel(id, data),
    [accessibility],
  );

  return (
    <DragDropProvider
      {...provider}
      collisionDetection={collisionDetection ?? detector}
      accessibility={{ ...accessibility, getLabel }}
      canDrop={(context) => {
        const own = bridge.current?.judge(context.move) ?? { ok: true };
        if (!own.ok) return own;
        return canDrop?.(context) ?? true;
      }}
      onDragEnd={(event) => {
        bridge.current?.commit(event);
        onDragEnd?.(event);
      }}
      onDropRejected={(event) => {
        bridge.current?.rejected(event.move);
        onDropRejected?.(event);
      }}
    >
      <KanbanController
        columns={columns}
        onChange={onChange}
        rules={rules}
        getColumnLabel={getColumnLabel}
        getCardLabel={getCardLabel}
        onMoveRejected={onMoveRejected}
        bridge={bridge}
      >
        {children}
      </KanbanController>
    </DragDropProvider>
  );
}

interface ControllerProps<Col extends KanbanColumnShape> {
  columns: readonly Col[];
  onChange: KanbanDndProps<Col>["onChange"];
  rules: KanbanRules<Col> | undefined;
  getColumnLabel: KanbanDndProps<Col>["getColumnLabel"];
  getCardLabel: KanbanDndProps<Col>["getCardLabel"];
  onMoveRejected: KanbanDndProps<Col>["onMoveRejected"];
  bridge: { current: Bridge | null };
  children: ReactNode;
}

const NO_RULES: KanbanRules<never> = {};

function KanbanController<Col extends KanbanColumnShape>({
  columns,
  onChange,
  rules = NO_RULES,
  getColumnLabel,
  getCardLabel,
  onMoveRejected,
  bridge,
  children,
}: ControllerProps<Col>): ReactNode {
  const engine = useDragEngine();
  const pendingFocus = useRef<UniqueId | null>(null);

  const latest = useRef({ columns, rules, onChange, onMoveRejected, getColumnLabel, getCardLabel });
  useIsomorphicLayoutEffect(() => {
    latest.current = { columns, rules, onChange, onMoveRejected, getColumnLabel, getCardLabel };
  });

  const cardLabel = useCallback((card: { readonly id: UniqueId }): string => {
    const custom = latest.current.getCardLabel;
    return custom ? custom(card as CardOf<Col>) : labelFrom(card, card.id);
  }, []);
  const columnLabel = useCallback((column: KanbanColumnShape): string => {
    const custom = latest.current.getColumnLabel;
    return custom ? custom(column as Col) : labelFrom(column, column.id);
  }, []);

  const interpret = useCallback(
    (
      move: SortableMove | null,
    ): { type: "card"; move: CardMove } | { type: "column"; move: ColumnMove } | null => {
      if (!move) return null;
      const { columns: board } = latest.current;
      if (move.fromContainerId === COLUMNS_CONTAINER) {
        const column = board.find((c) => columnItemId(c.id) === move.activeId);
        return column ? { type: "column", move: { columnId: column.id, toIndex: move.toIndex } } : null;
      }
      const target = board.find((c) => cardsContainerId(c.id) === move.toContainerId);
      if (!target) return null;
      return { type: "card", move: { cardId: move.activeId, toColumnId: target.id, toIndex: move.toIndex } };
    },
    [],
  );

  const judge = useCallback<Bridge["judge"]>(
    (move) => {
      const intent = interpret(move);
      if (!intent) return { ok: true };
      const { columns: board, rules: r } = latest.current;
      const verdict =
        intent.type === "card"
          ? canMoveCard(board, intent.move, r)
          : canMoveColumn(board, intent.move, r);
      return verdict.ok ? { ok: true } : { ok: false, reason: verdict.message };
    },
    [interpret],
  );

  const rejected = useCallback<Bridge["rejected"]>(
    (move) => {
      const intent = interpret(move);
      if (!intent) return;
      const { columns: board, rules: r } = latest.current;
      const verdict =
        intent.type === "card"
          ? canMoveCard(board, intent.move, r)
          : canMoveColumn(board, intent.move, r);
      if (!verdict.ok) {
        latest.current.onMoveRejected?.({ reason: verdict.reason, message: verdict.message }, intent.move);
      }
    },
    [interpret],
  );

  const commit = useCallback(
    (event: DragEndEvent) => {
      const intent = interpret(event.move);
      if (!intent) return;
      const { columns: board, rules: r, onChange: notify } = latest.current;
      const result =
        intent.type === "card" ? moveCard(board, intent.move, r) : moveColumn(board, intent.move, r);
      if (!result.ok) {
        if (result.reason !== "no-op") {
          latest.current.onMoveRejected?.({ reason: result.reason, message: result.message }, intent.move);
        }
        return;
      }
      notify?.(result.columns as unknown as readonly Col[], result.change);
    },
    [interpret],
  );

  useIsomorphicLayoutEffect(() => {
    const value: Bridge = {
      isColumnDrag: (activeId) => latest.current.columns.some((c) => columnItemId(c.id) === activeId),
      describeContainer: (id) => {
        const { columns: board } = latest.current;
        if (id === COLUMNS_CONTAINER) return "board columns";
        const byContainer = board.find((c) => cardsContainerId(c.id) === id);
        if (byContainer) return columnLabel(byContainer);
        const byItem = board.find((c) => columnItemId(c.id) === id);
        return byItem ? columnLabel(byItem) : undefined;
      },
      judge,
      commit,
      rejected,
    };
    bridge.current = value;
    return () => {
      if (bridge.current === value) bridge.current = null;
    };
  }, [bridge, judge, commit, rejected, columnLabel]);

  // Keyboard-moved cards re-mount in their new column; put focus back on them.
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    const els = engine.getDraggableElements(id);
    (els?.handle ?? els?.element)?.focus({ preventScroll: false });
  }, [columns, engine]);

  const step = useCallback<KanbanInternals["step"]>(
    (cardId, direction) => {
      const { columns: board, rules: r, onChange: notify } = latest.current;
      const source = findCard(board, cardId);
      if (!source) return false;
      let move: CardMove;
      if (direction === "up" || direction === "down") {
        move = {
          cardId,
          toColumnId: source.column.id,
          toIndex: source.index + (direction === "up" ? -1 : 1),
        };
      } else {
        const neighbour = board[source.columnIndex + (direction === "left" ? -1 : 1)];
        if (!neighbour) {
          engine.speak(direction === "left" ? "This is the first column." : "This is the last column.");
          return false;
        }
        move = { cardId, toColumnId: neighbour.id, toIndex: Math.min(source.index, neighbour.cards.length) };
      }
      const result = moveCard(board, move, r);
      if (!result.ok) {
        engine.speak(result.message);
        if (result.reason !== "no-op" && result.reason !== "invalid-index") {
          latest.current.onMoveRejected?.({ reason: result.reason, message: result.message }, move);
        }
        return false;
      }
      pendingFocus.current = cardId;
      notify?.(result.columns as unknown as readonly Col[], result.change);
      const target = findColumn(result.columns, move.toColumnId)?.column;
      const where = target ? columnLabel(target) : String(move.toColumnId);
      engine.speak(`${cardLabel(source.card)} moved to position ${move.toIndex + 1} in ${where}.`);
      return true;
    },
    [engine, cardLabel, columnLabel],
  );

  const value = useMemo<KanbanInternals>(
    () => ({
      engine,
      columns,
      rules: rules as KanbanRules<KanbanColumnShape>,
      cardLabel,
      columnLabel,
      step,
    }),
    [engine, columns, rules, cardLabel, columnLabel, step],
  );

  const columnItems = useMemo(() => columns.map((c) => columnItemId(c.id)), [columns]);

  return (
    <KanbanContext.Provider value={value}>
      <SortableContext id={COLUMNS_CONTAINER} items={columnItems} axis="x">
        {children}
      </SortableContext>
    </KanbanContext.Provider>
  );
}

// ---------------------------------------------------------------------------------- columns

interface ColumnContextValue {
  readonly columnId: UniqueId;
  readonly cardIds: readonly UniqueId[];
}
const ColumnContext = createContext<ColumnContextValue | null>(null);

export interface KanbanColumnState<Col extends KanbanColumnShape> {
  readonly column: Col;
  /** 0-based position of the column on the board. */
  readonly index: number;
  readonly cardCount: number;
  /** Attach to the element that is the column: it is both the drop zone and the sortable item. */
  setNodeRef: (node: HTMLElement | null) => void;
  /** Optional drag handle for reordering columns. Without it the column body is the activator. */
  setHandleRef: (node: HTMLElement | null) => void;
  /** Spread on the column handle (or the column). */
  handleAttributes: UseSortableReturn["attributes"];
  /** The column itself is being dragged. */
  isDragging: boolean;
  /** A dragged card is over this column. */
  isOver: boolean;
  /** A dragged card would land in this column if dropped now. */
  isDropTarget: boolean;
  /** `isOver`, but the drop would be rejected: show it with more than colour. */
  isInvalidOver: boolean;
  rejectionReason: string | null;
  /** Locked columns cannot be reordered. */
  locked: boolean;
  /** Transform/transition for column reordering feedback. */
  style: CSSProperties | undefined;
}

export interface KanbanColumnProps<Col extends KanbanColumnShape> {
  column: Col;
  index: number;
  children: (state: KanbanColumnState<Col>) => ReactNode;
}

/**
 * One column. It registers the column as a sortable item (for column reordering), wraps its
 * cards in a sortable container and registers the column element as the container's drop zone,
 * so even an empty column accepts cards.
 */
export function KanbanColumn<Col extends KanbanColumnShape>({
  column,
  index,
  children,
}: KanbanColumnProps<Col>): ReactNode {
  const kanban = useKanban("KanbanColumn");
  const locked = kanban.rules.isColumnLocked?.(column) ?? false;
  const label = kanban.columnLabel(column);
  const sortable = useSortable({
    id: columnItemId(column.id),
    data: { label, kind: "kanban-column" },
    disabled: locked,
  });
  const cardIds = useMemo(() => column.cards.map((c) => c.id), [column.cards]);
  const contextValue = useMemo<ColumnContextValue>(() => ({ columnId: column.id, cardIds }), [column.id, cardIds]);

  return (
    <ColumnContext.Provider value={contextValue}>
      <SortableContext id={cardsContainerId(column.id)} items={cardIds}>
        <ColumnBody column={column} index={index} sortable={sortable} locked={locked}>
          {children}
        </ColumnBody>
      </SortableContext>
    </ColumnContext.Provider>
  );
}

function ColumnBody<Col extends KanbanColumnShape>({
  column,
  index,
  sortable,
  locked,
  children,
}: {
  column: Col;
  index: number;
  sortable: UseSortableReturn;
  locked: boolean;
  children: (state: KanbanColumnState<Col>) => ReactNode;
}): ReactNode {
  const container = useSortableContainer({ data: { kind: "kanban-cards", columnId: column.id } });
  const { setNodeRef: setSortableRef, setActivatorNodeRef } = sortable;
  const { setNodeRef: setContainerRef } = container;
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setSortableRef(node);
      setContainerRef(node);
    },
    [setSortableRef, setContainerRef],
  );
  return (
    <>
      {children({
        column,
        index,
        cardCount: column.cards.length,
        setNodeRef,
        setHandleRef: setActivatorNodeRef,
        handleAttributes: sortable.attributes,
        isDragging: sortable.isDragging,
        isOver: container.isOver,
        isDropTarget: container.isDropTarget,
        isInvalidOver: container.isInvalidOver,
        rejectionReason: container.rejectionReason,
        locked,
        style: sortable.style,
      })}
    </>
  );
}

// ------------------------------------------------------------------------------------ cards

export interface UseKanbanCardReturn extends Omit<UseSortableReturn, "attributes"> {
  attributes: UseSortableReturn["attributes"] & {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  columnId: UniqueId;
  /** Locked cards cannot be dragged or moved with the keyboard fallback. */
  locked: boolean;
}

/**
 * A card inside a `<KanbanColumn>`. Returns the sortable bindings plus the Alt+Arrow keyboard
 * fallback (up/down reorder inside the column, left/right move to the neighbouring column).
 */
export function useKanbanCard(card: { readonly id: UniqueId }): UseKanbanCardReturn {
  const kanban = useKanban("useKanbanCard");
  const column = useContext(ColumnContext);
  if (!column) {
    throw new Error("[gripflow/kanban] useKanbanCard must be used inside a <KanbanColumn>.");
  }
  const owner = findColumn(kanban.columns, column.columnId)?.column;
  const locked = owner ? (kanban.rules.isCardLocked?.(card, owner) ?? false) : false;
  const sortable = useSortable({
    id: card.id,
    data: { label: kanban.cardLabel(card), kind: "kanban-card" },
    disabled: locked,
  });

  const { step, engine } = kanban;
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || event.target !== event.currentTarget) return;
      if (engine.getState().status !== "idle") return;
      const direction =
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "ArrowLeft"
              ? "left"
              : event.key === "ArrowRight"
                ? "right"
                : null;
      if (!direction) return;
      event.preventDefault();
      if (locked) {
        engine.speak("This card is locked and cannot be moved.");
        return;
      }
      step(card.id, direction);
    },
    [engine, step, card.id, locked],
  );

  return {
    ...sortable,
    attributes: { ...sortable.attributes, onKeyDown },
    columnId: column.columnId,
    locked,
  };
}

// ----------------------------------------------------------------------- convenience board

export interface KanbanOverlayInfo<Col extends KanbanColumnShape> {
  readonly type: "card" | "column";
  readonly card: CardOf<Col> | null;
  readonly column: Col | null;
}

export interface KanbanBoardProps<Col extends KanbanColumnShape> extends KanbanDndProps<Col> {
  /** Renders one column. Attach `state.setNodeRef`; place `cards` where the cards belong. */
  renderColumn: (state: KanbanColumnState<Col>, cards: ReactNode) => ReactNode;
  /** Renders one card. Call `useKanbanCard`-based state through the argument. */
  renderCard: (card: CardOf<Col>, state: UseKanbanCardReturn, column: Col) => ReactNode;
  /** Renders the drag preview. Omit to move the real element instead of using an overlay. */
  renderOverlay?: (info: KanbanOverlayInfo<Col>) => ReactNode;
  /** Wraps all columns, e.g. a flex container. Receives the rendered columns. */
  renderBoard?: (columns: ReactNode) => ReactNode;
}

function CardShell<Col extends KanbanColumnShape>({
  card,
  column,
  render,
}: {
  card: CardOf<Col>;
  column: Col;
  render: KanbanBoardProps<Col>["renderCard"];
}): ReactNode {
  const state = useKanbanCard(card);
  return <>{render(card, state, column)}</>;
}

/**
 * Ready-to-use composition of `KanbanDnd`, `KanbanColumn` and `useKanbanCard` driven by render
 * props. Still headless: you decide every element, class name and style.
 */
export function KanbanBoard<Col extends KanbanColumnShape>(props: KanbanBoardProps<Col>): ReactNode {
  const { renderColumn, renderCard, renderOverlay, renderBoard, ...dnd } = props;
  const { columns } = dnd;
  const board = columns.map((column, index) => (
    <KanbanColumn key={column.id} column={column} index={index}>
      {(state) =>
        renderColumn(
          state,
          column.cards.map((card) => (
            <CardShell<Col> key={card.id} card={card as CardOf<Col>} column={column} render={renderCard} />
          )),
        )
      }
    </KanbanColumn>
  ));
  return (
    <KanbanDnd<Col> {...dnd}>
      {renderBoard ? renderBoard(board) : board}
      {renderOverlay ? <OverlayHost columns={columns} render={renderOverlay} /> : null}
    </KanbanDnd>
  );
}

function OverlayHost<Col extends KanbanColumnShape>({
  columns,
  render,
}: {
  columns: readonly Col[];
  render: (info: KanbanOverlayInfo<Col>) => ReactNode;
}): ReactNode {
  return (
    <DragOverlay>
      {(active: ActiveInfo) => {
        const column = columns.find((c) => columnItemId(c.id) === active.id) ?? null;
        if (column) return render({ type: "column", card: null, column });
        const entry = findCard(columns, active.id);
        return render({ type: "card", card: entry ? entry.card : null, column: entry ? entry.column : null });
      }}
    </DragOverlay>
  );
}
