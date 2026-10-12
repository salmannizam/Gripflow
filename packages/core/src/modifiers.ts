import { createRect, toRect } from "./geometry";
import type { Coordinates, Rect, UniqueId } from "./primitives";

export interface ModifierArgs {
  readonly activeId: UniqueId;
  /** The dragged element, when one is registered. May be `null` for virtual items. */
  readonly activeElement: HTMLElement | null;
  /** Proposed pointer delta since activation (viewport coordinates). */
  readonly transform: Coordinates;
  /** The dragged rectangle when the drag started. */
  readonly activeRect: Rect;
  /** Pointer position when the drag started. */
  readonly origin: Coordinates;
}

/**
 * A modifier receives the proposed movement and returns the movement to apply.
 * Modifiers run in order and must be pure. They affect the overlay position, collision
 * rectangle and pointer used for collision detection consistently.
 */
export type Modifier = (args: ModifierArgs) => Coordinates;

export function applyModifiers(
  modifiers: readonly Modifier[] | undefined,
  args: ModifierArgs,
): Coordinates {
  if (!modifiers || modifiers.length === 0) return args.transform;
  let transform = args.transform;
  for (const modifier of modifiers) {
    transform = modifier({ ...args, transform });
  }
  return transform;
}

/** Locks movement to the x axis. */
export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ x: transform.x, y: 0 });

/** Locks movement to the y axis. */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ x: 0, y: transform.y });

function clamp(value: number, min: number, max: number): number {
  // When the bounds are smaller than the item, pin to the leading edge.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** Clamps the movement so the dragged rectangle stays inside `getBounds()`. */
export function restrictToBounds(getBounds: (args: ModifierArgs) => Rect | null): Modifier {
  return (args) => {
    const bounds = getBounds(args);
    if (!bounds) return args.transform;
    const { activeRect, transform } = args;
    return {
      x: clamp(transform.x, bounds.left - activeRect.left, bounds.right - activeRect.right),
      y: clamp(transform.y, bounds.top - activeRect.top, bounds.bottom - activeRect.bottom),
    };
  };
}

/** Keeps the item inside the viewport. */
export function restrictToWindowEdges(): Modifier {
  return restrictToBounds(() =>
    typeof window === "undefined"
      ? null
      : createRect(0, 0, window.innerWidth, window.innerHeight),
  );
}

/** Keeps the item inside a specific element (measured when the move happens). */
export function restrictToElement(
  target: HTMLElement | null | (() => HTMLElement | null),
): Modifier {
  return restrictToBounds(() => {
    const el = typeof target === "function" ? target() : target;
    return el ? toRect(el.getBoundingClientRect()) : null;
  });
}

/** Keeps the item inside its DOM parent. */
export function restrictToParentElement(): Modifier {
  return restrictToBounds(({ activeElement }) => {
    const parent = activeElement?.parentElement;
    return parent ? toRect(parent.getBoundingClientRect()) : null;
  });
}

/** Snaps movement to a grid. A size of `0` or less disables snapping on that axis. */
export function snapToGrid(size: number | Coordinates): Modifier {
  const gx = typeof size === "number" ? size : size.x;
  const gy = typeof size === "number" ? size : size.y;
  return ({ transform }) => ({
    x: gx > 0 ? Math.round(transform.x / gx) * gx : transform.x,
    y: gy > 0 ? Math.round(transform.y / gy) * gy : transform.y,
  });
}
