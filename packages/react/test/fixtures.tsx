import { useState, type ReactNode } from "react";
import {
  applySortableMove,
  type DragCancelEvent,
  type DragEndEvent,
  type UniqueId,
} from "@gripflow/core";
import {
  DragDropProvider,
  SortableContext,
  useSortable,
  useSortableContainer,
  type DragDropProviderProps,
} from "../src";

/**
 * jsdom has no layout engine, so elements describe their own geometry through a `data-rect`
 * attribute ("left,top,width,height") and this stub makes `getBoundingClientRect` honour it.
 */
export function installRectMock(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    const raw = this.getAttribute("data-rect");
    const [left = 0, top = 0, width = 0, height = 0] = raw ? raw.split(",").map(Number) : [];
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
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

export interface Recorded {
  ends: DragEndEvent[];
  cancels: DragCancelEvent[];
  log: string[];
}

export function createRecorder(): Recorded {
  return { ends: [], cancels: [], log: [] };
}

export function recorderHandlers(rec: Recorded): Pick<
  DragDropProviderProps,
  "onDragStart" | "onDragEnd" | "onDragCancel" | "onDragOver"
> {
  return {
    onDragStart: (e) => rec.log.push(`start:${e.active.id}`),
    onDragOver: (e) => rec.log.push(`over:${e.over?.id ?? "none"}`),
    onDragEnd: (e) => {
      rec.ends.push(e);
      rec.log.push(`end:${e.over?.id ?? "none"}`);
    },
    onDragCancel: (e) => {
      rec.cancels.push(e);
      rec.log.push(`cancel:${e.reason}`);
    },
  };
}

export interface ItemProps {
  id: UniqueId;
  index: number;
  left?: number;
  top?: number;
  disabled?: boolean;
  handle?: boolean;
  withButton?: boolean;
}

export function Item({ id, index, left = 0, top = 0, disabled, handle, withButton }: ItemProps): ReactNode {
  const s = useSortable({ id, disabled });
  const rect = `${left},${top + index * 50},200,50`;
  return (
    <li
      ref={s.setNodeRef}
      data-testid={`item-${id}`}
      data-rect={rect}
      data-dragging={s.isDragging}
      data-over={s.isOver}
      data-drop-position={s.dropPosition ?? ""}
      style={s.style}
      {...(handle ? {} : s.attributes)}
    >
      {handle ? (
        <span ref={s.setActivatorNodeRef} data-testid={`handle-${id}`} {...s.attributes}>
          drag
        </span>
      ) : null}
      {String(id)}
      {withButton ? <button data-testid={`button-${id}`}>action</button> : null}
    </li>
  );
}

export interface SortableListProps extends Omit<DragDropProviderProps, "children"> {
  initial: readonly string[];
  disabledIds?: readonly string[];
  rec?: Recorded;
  handle?: boolean;
  withButton?: boolean;
  /** Return false to reject (leave the order unchanged) like a consumer validating a move. */
  accept?: boolean;
  children?: ReactNode;
}

export function orderOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("li")).map((li) => li.getAttribute("data-testid")?.replace("item-", "") ?? "");
}

/** A controlled single-list sortable: the consumer owns the array, Gripflow only reports moves. */
export function SortableList({
  initial,
  disabledIds = [],
  rec,
  handle,
  withButton,
  accept = true,
  children,
  ...provider
}: SortableListProps): ReactNode {
  const [items, setItems] = useState<readonly string[]>(initial);
  const handlers = rec ? recorderHandlers(rec) : {};
  return (
    <DragDropProvider
      animation={{ enabled: false }}
      accessibility={{ announcements: false }}
      {...handlers}
      {...provider}
      onDragEnd={(e) => {
        handlers.onDragEnd?.(e);
        provider.onDragEnd?.(e);
        if (accept && e.move) {
          const move = e.move;
          setItems((current) => {
            const next = applySortableMove({ list: current }, move, (id) => id);
            return next["list"] as readonly string[];
          });
        }
      }}
    >
      <SortableContext id="list" items={items}>
        <ul data-testid="list" data-rect="0,0,200,1000">
          {items.map((id, index) => (
            <Item
              key={id}
              id={id}
              index={index}
              disabled={disabledIds.includes(id)}
              handle={handle}
              withButton={withButton}
            />
          ))}
        </ul>
      </SortableContext>
      {children}
    </DragDropProvider>
  );
}

function Column({
  id,
  column,
  items,
}: {
  id: string;
  column: number;
  items: readonly string[];
}): ReactNode {
  const c = useSortableContainer();
  const height = Math.max(items.length, 1) * 50 + 20;
  return (
    <section
      ref={c.setNodeRef}
      data-testid={`column-${id}`}
      data-rect={`${column * 300},0,200,${height}`}
      data-over={c.isOver}
      data-drop-target={c.isDropTarget}
    >
      <ul>
        {items.map((item, index) => (
          <Item key={item} id={item} index={index} left={column * 300} />
        ))}
      </ul>
    </section>
  );
}

export interface BoardProps extends Omit<DragDropProviderProps, "children"> {
  initial: Readonly<Record<string, readonly string[]>>;
  rec?: Recorded;
}

/** Controlled multi-container board for cross-container tests. */
export function Board({ initial, rec, ...provider }: BoardProps): ReactNode {
  const [columns, setColumns] = useState(initial);
  const handlers = rec ? recorderHandlers(rec) : {};
  return (
    <DragDropProvider
      animation={{ enabled: false }}
      accessibility={{ announcements: false }}
      {...handlers}
      {...provider}
      onDragEnd={(e) => {
        handlers.onDragEnd?.(e);
        if (e.move) {
          const move = e.move;
          setColumns((current) => applySortableMove(current, move, (id) => id));
        }
      }}
    >
      {Object.entries(columns).map(([id, items], column) => (
        <SortableContext key={id} id={id} items={items}>
          <Column id={id} column={column} items={items} />
        </SortableContext>
      ))}
    </DragDropProvider>
  );
}
