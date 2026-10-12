import { createRect } from "../geometry";
import type { Coordinates, Rect } from "../primitives";

export interface SortingStrategyArgs {
  /** Index of the dragged item in *this* container, or `-1` if it comes from elsewhere. */
  readonly activeIndex: number;
  /** Insertion index in *this* container, or `-1` if the dragged item is not heading here. */
  readonly overIndex: number;
  /** Index of the item whose transform is being computed. */
  readonly index: number;
  /** Measured rects of this container's items (original layout, no transforms applied). */
  readonly rects: readonly (Rect | undefined)[];
  /** The dragged item's rect at activation time. */
  readonly activeRect: Rect;
}

/**
 * A sorting strategy returns the displacement an item needs so there is room for the dragged
 * item (`null` = stay put). It must be pure. Used for same-container sorting and for the
 * source/destination containers of a cross-container move.
 */
export type SortingStrategy = (args: SortingStrategyArgs) => Coordinates | null;

const NONE = null;

interface ListStrategyOptions {
  axis: "x" | "y";
  /** Set when the visual order is the reverse of the DOM order (e.g. `flex-direction: column-reverse`). */
  reverse?: boolean;
}

function spacing(
  rects: readonly (Rect | undefined)[],
  axis: "x" | "y",
  reverse: boolean,
): number {
  for (let i = 0; i < rects.length - 1; i++) {
    const a = rects[i];
    const b = rects[i + 1];
    if (!a || !b) continue;
    const gap =
      axis === "y"
        ? reverse
          ? a.top - b.bottom
          : b.top - a.bottom
        : reverse
          ? a.left - b.right
          : b.left - a.right;
    return Math.max(0, gap);
  }
  return 0;
}

/** Builds a list strategy for a single axis. */
export function createListStrategy({ axis, reverse = false }: ListStrategyOptions): SortingStrategy {
  return ({ activeIndex, overIndex, index, rects, activeRect }) => {
    if (activeIndex < 0 && overIndex < 0) return NONE;
    if (index === activeIndex) return NONE;
    const size = axis === "y" ? activeRect.height : activeRect.width;
    const space = size + spacing(rects, axis, reverse);
    const direction = reverse ? -1 : 1;
    let shift = 0;
    if (activeIndex >= 0 && overIndex >= 0) {
      if (activeIndex < overIndex && index > activeIndex && index <= overIndex) shift = -space;
      else if (activeIndex > overIndex && index >= overIndex && index < activeIndex) shift = space;
    } else if (activeIndex < 0) {
      if (index >= overIndex) shift = space;
    } else if (index > activeIndex) {
      shift = -space;
    }
    if (shift === 0) return NONE;
    return axis === "y" ? { x: 0, y: shift * direction } : { x: shift * direction, y: 0 };
  };
}

export const verticalListStrategy: SortingStrategy = createListStrategy({ axis: "y" });
export const horizontalListStrategy: SortingStrategy = createListStrategy({ axis: "x" });

/** Strategy that never moves siblings. Useful when you render your own drop indicator. */
export const noSortingStrategy: SortingStrategy = () => NONE;

/** Where item `index` ends up after the move, in the *projected* arrangement. */
function projectedIndex(index: number, activeIndex: number, overIndex: number): number {
  if (activeIndex >= 0 && overIndex >= 0) {
    if (activeIndex < overIndex && index > activeIndex && index <= overIndex) return index - 1;
    if (activeIndex > overIndex && index >= overIndex && index < activeIndex) return index + 1;
    return index;
  }
  if (activeIndex < 0) return index >= overIndex ? index + 1 : index;
  return index > activeIndex ? index - 1 : index;
}

/** Computes the rect of the slot just after the last item, wrapping to a new row when needed. */
function extrapolateSlot(rects: readonly (Rect | undefined)[], activeRect: Rect): Rect | undefined {
  const present = rects.filter((r): r is Rect => r !== undefined);
  const first = present[0];
  const last = present[present.length - 1];
  if (!first || !last) return undefined;
  const sameRow = (r: Rect) => Math.abs(r.top - first.top) < Math.max(1, first.height / 2);
  const columns = present.filter(sameRow).length;
  const second = present[1];
  const sameRowSecond = second && sameRow(second) ? second : undefined;
  const stepX = sameRowSecond ? sameRowSecond.left - first.left : activeRect.width;
  const gapX = sameRowSecond ? Math.max(0, sameRowSecond.left - first.right) : 0;
  const nextRowFirst = present[columns];
  const rowPitch = nextRowFirst ? nextRowFirst.top - first.top : last.height + gapX;
  if (present.length % columns === 0) {
    const top = last.top + rowPitch;
    return createRect(first.left, top, first.width, first.height);
  }
  return createRect(last.left + stepX, last.top, last.width, last.height);
}

/**
 * Slot-based strategy for grids and galleries: every sibling moves into the slot occupied by
 * its projected neighbour. Assumes items in a container are laid out with consistent slots.
 */
export const rectSortingStrategy: SortingStrategy = ({
  activeIndex,
  overIndex,
  index,
  rects,
  activeRect,
}) => {
  if (activeIndex < 0 && overIndex < 0) return NONE;
  if (index === activeIndex) return NONE;
  const next = projectedIndex(index, activeIndex, overIndex);
  if (next === index) return NONE;
  const own = rects[index];
  const slot = next < rects.length ? rects[next] : extrapolateSlot(rects, activeRect);
  if (!own || !slot) return NONE;
  return { x: slot.left - own.left, y: slot.top - own.top };
};
