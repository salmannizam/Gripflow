/**
 * Primitive value types shared by every Gripflow package.
 * These are pure data shapes - nothing here touches the DOM.
 */

/** Stable identity of a draggable, droppable or sortable item. Never an array index. */
export type UniqueId = string | number;

/** A point or a delta in CSS pixels. */
export interface Coordinates {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in CSS pixels. All sides are kept to avoid recomputation. */
export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Arbitrary consumer data attached to registrations and echoed back in events. */
export type DragData = Readonly<Record<string, unknown>>;

/** Origin of an activation, e.g. `"pointer"`, `"keyboard"` or a custom sensor name. */
export type ActivatorKind = string;

/** Why an operation ended without being committed. */
export type CancelReason =
  | "escape"
  | "no-target"
  | "rejected"
  | "source-removed"
  | "source-disabled"
  | "interrupted"
  | "error"
  | "destroyed"
  | "programmatic"
  | (string & {});
