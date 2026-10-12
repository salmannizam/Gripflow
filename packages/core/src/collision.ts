import {
  distanceBetween,
  intersectionArea,
  pointInPolygon,
  pointInRect,
  polygonCentroid,
  rectCenter,
  rectCorners,
} from "./geometry";
import type { Coordinates, DragData, Rect, UniqueId } from "./primitives";

/** The role a droppable plays; used by container-aware detection. */
export type DroppableKind = "target" | "container" | "item";

/** An immutable view of a droppable at the time collision detection runs. */
export interface DroppableSnapshot {
  readonly id: UniqueId;
  /** Scroll-adjusted rectangle in viewport coordinates. */
  readonly rect: Rect;
  readonly kind: DroppableKind;
  /** For `item` droppables: the container they belong to. */
  readonly containerId: UniqueId | undefined;
  /** Number of droppable ancestors in the DOM. Deeper elements win ties. */
  readonly depth: number;
  /** Registration order. Used as a deterministic tie-breaker. */
  readonly order: number;
  readonly data: DragData | undefined;
}

export interface Collision {
  readonly id: UniqueId;
  /** Detector-specific score (distance, overlap ratio...). Meaning is documented per detector. */
  readonly value: number;
  readonly droppable: DroppableSnapshot;
}

export interface CollisionArgs {
  readonly activeId: UniqueId;
  /** The dragged rectangle after modifiers, in viewport coordinates. */
  readonly collisionRect: Rect;
  /** The pointer after modifiers, in viewport coordinates. */
  readonly pointer: Coordinates;
  readonly droppables: readonly DroppableSnapshot[];
}

/**
 * Collision strategy contract: return candidates ordered best-first. Return `[]` when
 * nothing qualifies. Implementations must be pure and deterministic.
 */
export type CollisionDetector = (args: CollisionArgs) => Collision[];

function byTieBreak(a: DroppableSnapshot, b: DroppableSnapshot): number {
  if (a.depth !== b.depth) return b.depth - a.depth;
  if (a.order !== b.order) return a.order - b.order;
  const ai = String(a.id);
  const bi = String(b.id);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * Deterministic ordering: by score, then deeper element first, then registration order,
 * then id. Exposed so custom detectors can reuse the same tie-breaking.
 */
export function sortCollisions(collisions: Collision[], direction: "asc" | "desc"): Collision[] {
  const sign = direction === "asc" ? 1 : -1;
  return collisions.sort((a, b) => {
    if (a.value !== b.value) return (a.value - b.value) * sign;
    return byTieBreak(a.droppable, b.droppable);
  });
}

const EPSILON = 1e-9;

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

function sortWithEpsilon(collisions: Collision[], direction: "asc" | "desc"): Collision[] {
  const sign = direction === "asc" ? 1 : -1;
  return collisions.sort((a, b) => {
    if (!almostEqual(a.value, b.value)) return (a.value - b.value) * sign;
    return byTieBreak(a.droppable, b.droppable);
  });
}

/**
 * Targets whose rectangle contains the pointer. Nested targets win (deepest first), then the
 * smallest rectangle. `value` is the rectangle area.
 */
export const pointerWithin: CollisionDetector = ({ pointer, droppables }) => {
  const hits: Collision[] = [];
  for (const droppable of droppables) {
    if (pointInRect(pointer, droppable.rect)) {
      hits.push({
        id: droppable.id,
        value: droppable.rect.width * droppable.rect.height,
        droppable,
      });
    }
  }
  return hits.sort((a, b) => {
    if (a.droppable.depth !== b.droppable.depth) return b.droppable.depth - a.droppable.depth;
    if (a.value !== b.value) return a.value - b.value;
    return byTieBreak(a.droppable, b.droppable);
  });
};

/**
 * Targets that overlap the dragged rectangle, best overlap first.
 * `value` is the intersection-over-union ratio in (0, 1].
 */
export const rectIntersection: CollisionDetector = ({ collisionRect, droppables }) => {
  const hits: Collision[] = [];
  const dragArea = collisionRect.width * collisionRect.height;
  for (const droppable of droppables) {
    const overlap = intersectionArea(collisionRect, droppable.rect);
    if (overlap <= 0) continue;
    const union = dragArea + droppable.rect.width * droppable.rect.height - overlap;
    hits.push({ id: droppable.id, value: union > 0 ? overlap / union : 0, droppable });
  }
  return sortWithEpsilon(hits, "desc");
};

/** Every target ordered by distance between centers (ascending). `value` is the distance. */
export const closestCenter: CollisionDetector = ({ collisionRect, droppables }) => {
  const center = rectCenter(collisionRect);
  return sortWithEpsilon(
    droppables.map((droppable) => ({
      id: droppable.id,
      value: distanceBetween(center, rectCenter(droppable.rect)),
      droppable,
    })),
    "asc",
  );
};

/** Every target ordered by the summed distance between matching corners. `value` is the sum. */
export const closestCorners: CollisionDetector = ({ collisionRect, droppables }) => {
  const dragCorners = rectCorners(collisionRect);
  return sortWithEpsilon(
    droppables.map((droppable) => {
      const corners = rectCorners(droppable.rect);
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const a = dragCorners[i];
        const b = corners[i];
        if (a && b) sum += distanceBetween(a, b);
      }
      return { id: droppable.id, value: sum / 4, droppable };
    }),
    "asc",
  );
};

/**
 * Geometry-based targeting for non-rectangular drop zones. `getShape` returns a polygon in
 * viewport coordinates (or `null` to fall back to the rectangle). The pointer must be inside
 * the polygon; `value` is the distance to the polygon centroid.
 */
export function shapeWithin(
  getShape: (droppable: DroppableSnapshot) => readonly Coordinates[] | null,
): CollisionDetector {
  return ({ pointer, droppables }) => {
    const hits: Collision[] = [];
    for (const droppable of droppables) {
      const polygon = getShape(droppable) ?? rectPolygon(droppable.rect);
      if (polygon.length >= 3 && pointInPolygon(pointer, polygon)) {
        hits.push({
          id: droppable.id,
          value: distanceBetween(pointer, polygonCentroid(polygon)),
          droppable,
        });
      }
    }
    return hits.sort((a, b) => {
      if (a.droppable.depth !== b.droppable.depth) return b.droppable.depth - a.droppable.depth;
      if (!almostEqual(a.value, b.value)) return a.value - b.value;
      return byTieBreak(a.droppable, b.droppable);
    });
  };
}

/** A rectangle as a perimeter-ordered polygon (TL, TR, BR, BL). */
function rectPolygon(rect: Rect): readonly Coordinates[] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

/** Uses the first detector that returns a result. */
export function composeDetectors(...detectors: CollisionDetector[]): CollisionDetector {
  return (args) => {
    for (const detect of detectors) {
      const result = detect(args);
      if (result.length > 0) return result;
    }
    return [];
  };
}

/** Restricts a detector to droppables that satisfy `predicate`. */
export function filterDroppables(
  detector: CollisionDetector,
  predicate: (droppable: DroppableSnapshot, args: CollisionArgs) => boolean,
): CollisionDetector {
  return (args) => detector({ ...args, droppables: args.droppables.filter((d) => predicate(d, args)) });
}

/** Drops candidates whose `value` (a distance-style score) exceeds `maxDistance`. */
export function limitDistance(detector: CollisionDetector, maxDistance: number): CollisionDetector {
  return (args) => detector(args).filter((c) => c.value <= maxDistance);
}

/**
 * Re-orders any detector's output so that deeper (more nested) targets come first.
 * The relative order within a depth level is preserved.
 */
export function prioritizeNested(detector: CollisionDetector): CollisionDetector {
  return (args) => {
    const hits = detector(args);
    return hits
      .map((hit, index) => ({ hit, index }))
      .sort((a, b) => b.hit.droppable.depth - a.hit.droppable.depth || a.index - b.index)
      .map((entry) => entry.hit);
  };
}

export interface ContainerAwareOptions {
  /** Finds the container the dragged item is currently "in". */
  containerDetector?: CollisionDetector;
  /** Picks the item inside that container. */
  itemDetector?: CollisionDetector;
  /** Used for plain (non-sortable) drop targets and when no container matches. */
  targetDetector?: CollisionDetector;
}

/**
 * Two-stage detection for multi-container layouts (lists, boards, trees):
 * 1. find the container under the pointer, 2. choose the closest item inside it.
 * Empty containers resolve to the container itself. Plain targets outside of every container
 * are resolved with `targetDetector`. Container-only registrations behave like plain targets.
 */
export function containerAware(options: ContainerAwareOptions = {}): CollisionDetector {
  const containerDetector = options.containerDetector ?? composeDetectors(pointerWithin, rectIntersection);
  const itemDetector = options.itemDetector ?? closestCenter;
  const targetDetector = options.targetDetector ?? composeDetectors(pointerWithin, rectIntersection);
  return (args) => {
    const containers = args.droppables.filter((d) => d.kind === "container");
    const containerIds = new Set(containers.map((d) => d.id));
    // Items whose container has no element of its own (a <SortableContext> without a container
    // droppable) still need to be hit-testable, so they behave like plain targets.
    const plain = args.droppables.filter(
      (d) =>
        d.kind === "target" ||
        (d.kind === "item" && (d.containerId === undefined || !containerIds.has(d.containerId))),
    );
    if (containers.length === 0) {
      return targetDetector({ ...args, droppables: plain });
    }
    const [topContainer] = containerDetector({ ...args, droppables: containers });
    if (!topContainer) {
      return targetDetector({ ...args, droppables: plain });
    }
    // A plain target nested deeper than the container (e.g. a trash zone on top of it) wins.
    const nestedPlain = pointerWithin({
      ...args,
      droppables: plain.filter((d) => d.depth > topContainer.droppable.depth),
    });
    const items = args.droppables.filter(
      (d) => d.kind === "item" && d.containerId === topContainer.id,
    );
    const itemHits = items.length > 0 ? itemDetector({ ...args, droppables: items }) : [];
    return [...nestedPlain, ...itemHits, topContainer];
  };
}

/** Default detector used by the engine: container-aware with sensible fallbacks. */
export const defaultCollisionDetector: CollisionDetector = containerAware();
