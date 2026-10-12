import type { Coordinates, Rect } from "./primitives";

/** Builds a {@link Rect} from its origin and size. */
export function createRect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** Converts any rect-like object (e.g. a `DOMRect`) to a plain immutable {@link Rect}. */
export function toRect(r: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Rect {
  return createRect(r.left, r.top, r.width, r.height);
}

export function rectCenter(rect: Rect): Coordinates {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Moves a rect by `delta`. */
export function translateRect(rect: Rect, delta: Coordinates): Rect {
  return createRect(rect.left + delta.x, rect.top + delta.y, rect.width, rect.height);
}

export function rectCorners(rect: Rect): readonly [Coordinates, Coordinates, Coordinates, Coordinates] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom },
  ];
}

export function pointInRect(point: Coordinates, rect: Rect): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

/** Area of the overlap between two rects, `0` if they do not overlap. */
export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function distanceBetween(a: Coordinates, b: Coordinates): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function addCoordinates(a: Coordinates, b: Coordinates): Coordinates {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtractCoordinates(a: Coordinates, b: Coordinates): Coordinates {
  return { x: a.x - b.x, y: a.y - b.y };
}

export const ZERO: Coordinates = Object.freeze({ x: 0, y: 0 });

export function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  return a.x === b.x && a.y === b.y;
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Ray-casting point-in-polygon test. `polygon` needs at least three vertices. */
export function pointInPolygon(point: Coordinates, polygon: readonly Coordinates[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;
    const crosses =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(polygon: readonly Coordinates[]): Coordinates {
  if (polygon.length === 0) return ZERO;
  let x = 0;
  let y = 0;
  for (const p of polygon) {
    x += p.x;
    y += p.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}
