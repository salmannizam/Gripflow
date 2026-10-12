import type { DragData, UniqueId } from "./primitives";
import type { SortableProjection } from "./sortable/coordinator";
import type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropRejectedEvent,
} from "./types";

export interface AnnouncementContext {
  /** Human readable label of an id. Uses `data.label` when present. */
  getLabel(id: UniqueId, data?: DragData): string;
  /** Current sortable projection, when the dragged item is sortable. */
  projection: SortableProjection | null;
}

type Message = string | null | undefined;

/** Screen-reader messages. Return `null`/`undefined` to stay silent for an event. */
export interface Announcements {
  onDragStart(event: DragStartEvent, context: AnnouncementContext): Message;
  onDragOver(event: DragOverEvent, context: AnnouncementContext): Message;
  onDragEnd(event: DragEndEvent, context: AnnouncementContext): Message;
  onDragCancel(event: DragCancelEvent, context: AnnouncementContext): Message;
  onDropRejected(event: DropRejectedEvent, context: AnnouncementContext): Message;
}

export interface AccessibilityOptions {
  /** Override individual messages, or `false` to disable the live region entirely. */
  announcements?: Partial<Announcements> | false;
  /** Instructions linked through `aria-describedby`. `false` removes them. */
  instructions?: string | false;
  /**
   * DOM id of the instructions element referenced by `aria-describedby`. Adapters pass a
   * framework-generated id (e.g. React `useId`) so server and client markup agree.
   */
  instructionsId?: string;
  /** Default `"assertive"`. */
  politeness?: "assertive" | "polite";
  /** Customise how ids are spoken. */
  getLabel?: (id: UniqueId, data?: DragData) => string;
}

export const DEFAULT_INSTRUCTIONS =
  "To pick up a draggable item, press space or enter. While dragging, use the arrow keys to move it. " +
  "Press space or enter again to drop it, or press escape to cancel.";

export function defaultGetLabel(id: UniqueId, data?: DragData): string {
  const label = data?.["label"];
  return typeof label === "string" && label.length > 0 ? label : String(id);
}

function position(projection: SortableProjection | null, ctx: AnnouncementContext): string {
  if (!projection) return "";
  const { move, destinationSize } = projection;
  return ` position ${move.toIndex + 1} of ${destinationSize} in ${ctx.getLabel(move.toContainerId)}`;
}

export function createDefaultAnnouncements(): Announcements {
  return {
    onDragStart: ({ active }, ctx) => `Picked up ${ctx.getLabel(active.id, active.data)}.`,
    onDragOver: ({ active, over, valid, move }, ctx) => {
      const name = ctx.getLabel(active.id, active.data);
      if (!over) return `${name} is no longer over a drop target.`;
      if (!valid) return `${name} cannot be dropped on ${ctx.getLabel(over.id, over.data)}.`;
      if (move) return `${name} moved to${position(ctx.projection, ctx)}.`;
      return `${name} is over ${ctx.getLabel(over.id, over.data)}.`;
    },
    onDragEnd: ({ active, over, move }, ctx) => {
      const name = ctx.getLabel(active.id, active.data);
      if (move) return `${name} was dropped at${position(ctx.projection, ctx)}.`;
      if (over) return `${name} was dropped on ${ctx.getLabel(over.id, over.data)}.`;
      return `${name} was dropped.`;
    },
    onDragCancel: ({ active, reason }, ctx) =>
      reason === "rejected"
        ? `${ctx.getLabel(active.id, active.data)} could not be dropped there and returned to its starting position.`
        : `Dragging was cancelled. ${ctx.getLabel(active.id, active.data)} returned to its starting position.`,
    onDropRejected: () => null,
  };
}

const VISUALLY_HIDDEN =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";

/** A visually hidden `aria-live` region appended to `<body>`. Browser-only. */
export class LiveAnnouncer {
  private readonly region: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(doc: Document, politeness: "assertive" | "polite" = "assertive") {
    this.region = doc.createElement("div");
    this.region.setAttribute("role", "status");
    this.region.setAttribute("aria-live", politeness);
    this.region.setAttribute("aria-atomic", "true");
    this.region.setAttribute("data-gripflow-live-region", "");
    this.region.setAttribute("style", VISUALLY_HIDDEN);
    doc.body.appendChild(this.region);
  }

  announce(message: string): void {
    // Clearing first makes screen readers re-read identical consecutive messages.
    this.region.textContent = "";
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.region.textContent = message;
    }, 0);
  }

  get text(): string {
    return this.region.textContent ?? "";
  }

  destroy(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.region.remove();
  }
}

/** Appends a hidden element holding instructions for `aria-describedby`. Returns a remover. */
export function mountInstructions(doc: Document, id: string, text: string): () => void {
  const el = doc.createElement("div");
  el.id = id;
  el.setAttribute("data-gripflow-instructions", "");
  el.setAttribute("style", VISUALLY_HIDDEN);
  el.textContent = text;
  doc.body.appendChild(el);
  return () => el.remove();
}
