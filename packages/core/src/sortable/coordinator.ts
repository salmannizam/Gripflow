import { rectCenter } from "../geometry";
import type { Coordinates, Rect, UniqueId } from "../primitives";
import type { SortableMove } from "./array";
import { verticalListStrategy, type SortingStrategy } from "./strategies";

export interface InsertionContext {
  readonly activeId: UniqueId;
  readonly fromContainerId: UniqueId;
  readonly toContainerId: UniqueId;
  readonly overId: UniqueId;
  /** Index computed by the default algorithm. */
  readonly defaultIndex: number;
  readonly items: readonly UniqueId[];
}

export interface SortableContainerConfig {
  readonly id: UniqueId;
  /** Item ids in render order. Stable ids, never indexes. */
  readonly items: readonly UniqueId[];
  readonly strategy?: SortingStrategy;
  /** Layout axis used to decide "before/after" for cross-container inserts. Default `"y"`. */
  readonly axis?: "x" | "y" | "grid";
  /** A disabled container never receives items from other containers. */
  readonly disabled?: boolean;
  /** Override the insertion index. Return `null` to keep the default. */
  readonly resolveIndex?: (context: InsertionContext) => number | null;
}

export interface SortableProjection {
  readonly move: SortableMove;
  readonly overId: UniqueId;
  /** Displacement for every sibling that must make room. Items not listed stay put. */
  readonly transforms: ReadonlyMap<UniqueId, Coordinates>;
  /** Length of the destination container once the move is committed. */
  readonly destinationSize: number;
}

export interface ProjectionInput {
  readonly activeId: UniqueId;
  readonly overId: UniqueId;
  readonly collisionRect: Rect;
  readonly activeRect: Rect;
  readonly getRect: (id: UniqueId) => Rect | undefined;
}

const EMPTY_TRANSFORMS: ReadonlyMap<UniqueId, Coordinates> = new Map();

/**
 * Framework- and DOM-independent sorting model. It knows which items live in which container
 * and, for a given "over" target, computes the projected move and sibling displacements.
 */
export class SortableCoordinator {
  private readonly containers = new Map<UniqueId, SortableContainerConfig>();
  private readonly owners = new Map<UniqueId, UniqueId>();
  private last: SortableProjection | null = null;
  private lastKey = "";

  /** Registers (or replaces) a container. Returns an unregister function. */
  register(config: SortableContainerConfig): () => void {
    this.containers.set(config.id, config);
    this.reindex();
    this.invalidate();
    return () => {
      if (this.containers.get(config.id) === config) {
        this.containers.delete(config.id);
        this.reindex();
        this.invalidate();
      }
    };
  }

  hasContainer(id: UniqueId): boolean {
    return this.containers.has(id);
  }

  isItem(id: UniqueId): boolean {
    return this.owners.has(id);
  }

  getContainerOf(id: UniqueId): UniqueId | undefined {
    return this.owners.get(id);
  }

  getContainer(id: UniqueId): SortableContainerConfig | undefined {
    return this.containers.get(id);
  }

  /** Forget the cached projection (e.g. after geometry changed). */
  invalidate(): void {
    this.last = null;
    this.lastKey = "";
  }

  private reindex(): void {
    this.owners.clear();
    for (const container of this.containers.values()) {
      for (const id of container.items) this.owners.set(id, container.id);
    }
  }

  /** Returns the move that would happen if `activeId` were dropped on `overId` right now. */
  project(input: ProjectionInput): SortableProjection | null {
    const move = this.resolveMove(input);
    if (!move) {
      this.invalidate();
      return null;
    }
    const key = `${move.fromContainerId}|${move.fromIndex}|${move.toContainerId}|${move.toIndex}|${String(input.overId)}`;
    if (this.last && key === this.lastKey) return this.last;
    const projection = this.buildProjection(move, input);
    this.last = projection;
    this.lastKey = key;
    return projection;
  }

  private resolveMove(input: ProjectionInput): SortableMove | null {
    const { activeId, overId, collisionRect } = input;
    const fromId = this.owners.get(activeId);
    if (fromId === undefined) return null;
    const from = this.containers.get(fromId);
    if (!from) return null;
    const fromIndex = from.items.indexOf(activeId);
    if (fromIndex < 0) return null;

    let toId: UniqueId;
    let toIndex: number;
    const overOwner = this.owners.get(overId);

    if (overId === activeId) {
      toId = fromId;
      toIndex = fromIndex;
    } else if (overOwner !== undefined) {
      toId = overOwner;
      const target = this.containers.get(toId);
      if (!target) return null;
      const overIndex = target.items.indexOf(overId);
      if (overIndex < 0) return null;
      if (toId === fromId) {
        toIndex = overIndex;
      } else {
        const overRect = input.getRect(overId);
        const after = overRect ? isAfter(collisionRect, overRect, target.axis ?? "y") : false;
        toIndex = overIndex + (after ? 1 : 0);
      }
    } else if (this.containers.has(overId)) {
      toId = overId;
      const target = this.containers.get(toId);
      if (!target) return null;
      toIndex = toId === fromId ? fromIndex : target.items.length;
    } else {
      return null;
    }

    const destination = this.containers.get(toId);
    if (!destination) return null;
    if (toId !== fromId && destination.disabled) return null;
    if (destination.resolveIndex) {
      const custom = destination.resolveIndex({
        activeId,
        fromContainerId: fromId,
        toContainerId: toId,
        overId,
        defaultIndex: toIndex,
        items: destination.items,
      });
      if (custom !== null) {
        const max = toId === fromId ? destination.items.length - 1 : destination.items.length;
        toIndex = Math.max(0, Math.min(custom, max));
      }
    }
    return { activeId, fromContainerId: fromId, fromIndex, toContainerId: toId, toIndex };
  }

  private buildProjection(move: SortableMove, input: ProjectionInput): SortableProjection {
    const from = this.containers.get(move.fromContainerId);
    const to = this.containers.get(move.toContainerId);
    const destinationSize =
      (to?.items.length ?? 0) + (move.fromContainerId === move.toContainerId ? 0 : 1);
    const unchanged = move.fromContainerId === move.toContainerId && move.fromIndex === move.toIndex;
    if (!from || !to || unchanged) {
      return { move, overId: input.overId, transforms: EMPTY_TRANSFORMS, destinationSize };
    }
    const transforms = new Map<UniqueId, Coordinates>();
    const collect = (
      container: SortableContainerConfig,
      activeIndex: number,
      overIndex: number,
    ): void => {
      const strategy = container.strategy ?? verticalListStrategy;
      const rects = container.items.map((id) => input.getRect(id));
      container.items.forEach((id, index) => {
        if (id === input.activeId) return;
        const t = strategy({ activeIndex, overIndex, index, rects, activeRect: input.activeRect });
        if (t && (t.x !== 0 || t.y !== 0)) transforms.set(id, t);
      });
    };
    if (move.fromContainerId === move.toContainerId) {
      collect(to, move.fromIndex, move.toIndex);
    } else {
      collect(from, move.fromIndex, -1);
      collect(to, -1, move.toIndex);
    }
    return { move, overId: input.overId, transforms, destinationSize };
  }
}

function isAfter(active: Rect, over: Rect, axis: "x" | "y" | "grid"): boolean {
  const a = rectCenter(active);
  const o = rectCenter(over);
  if (axis === "x") return a.x > o.x;
  if (axis === "y") return a.y > o.y;
  const sameRow = Math.abs(a.y - o.y) < over.height / 2;
  return sameRow ? a.x > o.x : a.y > o.y;
}
