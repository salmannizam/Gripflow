import { addCoordinates, createRect, toRect, ZERO } from "./geometry";
import type { Coordinates, Rect, UniqueId } from "./primitives";

type Scroller = Element | Window;

interface Record_ {
  readonly element: HTMLElement;
  /** Rect expressed in the coordinate space of the scroll positions captured at drag start. */
  base: Rect;
  scrollers: readonly Scroller[];
  depth: number;
}

function isWindow(s: Scroller): s is Window {
  return typeof Window !== "undefined" && (s as Window).window === s;
}

function readOffset(scroller: Scroller): Coordinates {
  if (isWindow(scroller)) return { x: scroller.scrollX, y: scroller.scrollY };
  return { x: (scroller as Element).scrollLeft, y: (scroller as Element).scrollTop };
}

const SCROLLABLE = /(auto|scroll|overlay)/;

/** Whether an element can scroll (based on computed overflow, not on current content size). */
export function isScrollable(el: Element): boolean {
  if (typeof getComputedStyle === "undefined") return false;
  const style = getComputedStyle(el);
  return SCROLLABLE.test(style.overflow + style.overflowX + style.overflowY);
}

/** Returns the element's rect without its own translation, so transformed items measure as laid out. */
export function getLayoutRect(el: Element): Rect {
  const rect = el.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  if (typeof getComputedStyle !== "undefined") {
    const transform = getComputedStyle(el).transform;
    if (transform && transform !== "none") {
      const match = /^matrix(3d)?\((.+)\)$/.exec(transform);
      const body = match?.[2];
      if (body) {
        const v = body.split(",").map((n) => Number.parseFloat(n));
        const tx = match[1] ? v[12] : v[4];
        const ty = match[1] ? v[13] : v[5];
        if (typeof tx === "number" && Number.isFinite(tx)) left -= tx;
        if (typeof ty === "number" && Number.isFinite(ty)) top -= ty;
      }
    }
  }
  return createRect(left, top, rect.width, rect.height);
}

/**
 * Measures droppable geometry once per drag and keeps it correct while the page scrolls.
 *
 * Rather than re-measuring every element on every scroll event (O(n) layout reads), rects are
 * captured once and shifted by how far each of their scroll containers has scrolled.
 * Individual elements are re-measured when they resize or when asked to.
 */
export class GeometryCache {
  private records = new Map<UniqueId, Record_>();
  private initialOffsets = new Map<Scroller, Coordinates>();
  private currentOffsets = new Map<Scroller, Coordinates>();
  private rectCache = new Map<UniqueId, Rect>();
  private scrollerMemo = new Map<Element, Element | null>();
  private depthMemo = new Map<Element, number>();
  private droppableElements = new Set<Element>();
  private observer: ResizeObserver | null = null;
  private observed = new Map<Element, UniqueId>();
  private seen = new WeakSet<Element>();
  private detach: (() => void) | null = null;
  private dirty = true;

  /** Measures every given droppable. Replaces any previous measurements. */
  begin(targets: Iterable<readonly [UniqueId, HTMLElement | null]>): void {
    this.reset();
    const list: [UniqueId, HTMLElement][] = [];
    for (const [id, el] of targets) if (el) list.push([id, el]);
    for (const [, el] of list) this.droppableElements.add(el);
    for (const [id, el] of list) this.measureOne(id, el);
  }

  /** Measures a droppable that appeared mid-drag. */
  add(id: UniqueId, element: HTMLElement): void {
    this.droppableElements.add(element);
    this.measureOne(id, element);
    this.observe(id, element);
  }

  remove(id: UniqueId): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    this.rectCache.delete(id);
    this.droppableElements.delete(record.element);
    this.unobserve(record.element);
  }

  has(id: UniqueId): boolean {
    return this.records.has(id);
  }

  getDepth(id: UniqueId): number {
    return this.records.get(id)?.depth ?? 0;
  }

  /** Scroll-adjusted rect in viewport coordinates. */
  getRect(id: UniqueId): Rect | undefined {
    const cached = this.rectCache.get(id);
    if (cached && !this.dirty) return cached;
    const record = this.records.get(id);
    if (!record) return undefined;
    this.refreshOffsets();
    const delta = this.scrollDelta(record.scrollers);
    const rect = createRect(
      record.base.left - delta.x,
      record.base.top - delta.y,
      record.base.width,
      record.base.height,
    );
    this.rectCache.set(id, rect);
    return rect;
  }

  /** How far the element's scroll containers have scrolled since the drag began. */
  getScrollDelta(element: Element): Coordinates {
    this.refreshOffsets();
    return this.scrollDelta(this.scrollersOf(element));
  }

  /** Re-measures one droppable (or all when `id` is omitted). */
  remeasure(id?: UniqueId): void {
    if (id === undefined) {
      for (const [key, record] of [...this.records]) this.measureOne(key, record.element);
    } else {
      const record = this.records.get(id);
      if (record) this.measureOne(id, record.element);
    }
    this.rectCache.clear();
  }

  /** Marks scroll-derived data stale. Call from scroll handlers. */
  invalidateScroll(): void {
    this.dirty = true;
  }

  /**
   * Starts observing scroll, resize and element size changes. `onChange` fires after the cache
   * has been updated. Returns a disposer; also called by {@link dispose}.
   */
  watch(onChange: () => void): () => void {
    this.detach?.();
    const onScroll = () => {
      this.invalidateScroll();
      onChange();
    };
    const onResize = () => {
      this.remeasure();
      this.invalidateScroll();
      onChange();
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = this.observed.get(entry.target);
          if (id === undefined) continue;
          if (!this.seen.has(entry.target)) {
            this.seen.add(entry.target); // first callback just reports the initial size
            continue;
          }
          this.measureOne(id, entry.target as HTMLElement);
          changed = true;
        }
        if (changed) {
          this.rectCache.clear();
          onChange();
        }
      });
      for (const [id, record] of this.records) this.observe(id, record.element);
    }
    const detach = () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      this.observer?.disconnect();
      this.observer = null;
    };
    this.detach = detach;
    return () => {
      if (this.detach === detach) {
        detach();
        this.detach = null;
      }
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    this.reset();
  }

  private reset(): void {
    this.records.clear();
    this.initialOffsets.clear();
    this.currentOffsets.clear();
    this.rectCache.clear();
    this.scrollerMemo.clear();
    this.depthMemo.clear();
    this.droppableElements.clear();
    this.observed.clear();
    this.observer?.disconnect();
    this.seen = new WeakSet();
    this.dirty = true;
  }

  private observe(id: UniqueId, el: Element): void {
    if (!this.observer || this.observed.has(el)) return;
    this.observed.set(el, id);
    this.observer.observe(el);
  }

  private unobserve(el: Element): void {
    if (!this.observed.has(el)) return;
    this.observed.delete(el);
    this.observer?.unobserve(el);
  }

  private measureOne(id: UniqueId, element: HTMLElement): void {
    const scrollers = this.scrollersOf(element);
    this.refreshOffsets();
    const delta = this.scrollDelta(scrollers);
    const viewport = toRect(getLayoutRect(element));
    // base = viewport rect + scrolled distance, i.e. the rect as if nothing had scrolled yet.
    const base = createRect(
      viewport.left + delta.x,
      viewport.top + delta.y,
      viewport.width,
      viewport.height,
    );
    this.records.set(id, { element, base, scrollers, depth: this.depthOf(element) });
    this.rectCache.delete(id);
  }

  private depthOf(el: Element): number {
    const memo = this.depthMemo.get(el);
    if (memo !== undefined) return memo;
    const parent = el.parentElement;
    const depth = parent ? this.depthOf(parent) + (this.droppableElements.has(parent) ? 1 : 0) : 0;
    this.depthMemo.set(el, depth);
    return depth;
  }

  private nearestScroller(el: Element): Element | null {
    if (this.scrollerMemo.has(el)) return this.scrollerMemo.get(el) ?? null;
    const parent = el.parentElement;
    let result: Element | null = null;
    if (parent && parent !== document.documentElement && parent !== document.body) {
      result = isScrollable(parent) ? parent : this.nearestScroller(parent);
    }
    this.scrollerMemo.set(el, result);
    return result;
  }

  private scrollersOf(el: Element): Scroller[] {
    const chain: Scroller[] = [];
    let current = this.nearestScroller(el);
    while (current) {
      chain.push(current);
      current = this.nearestScroller(current);
    }
    chain.push(window);
    for (const s of chain) {
      if (!this.initialOffsets.has(s)) this.initialOffsets.set(s, readOffset(s));
    }
    return chain;
  }

  private refreshOffsets(): void {
    if (!this.dirty) return;
    this.currentOffsets.clear();
    for (const s of this.initialOffsets.keys()) this.currentOffsets.set(s, readOffset(s));
    this.rectCache.clear();
    this.dirty = false;
  }

  private scrollDelta(scrollers: readonly Scroller[]): Coordinates {
    let total: Coordinates = ZERO;
    for (const s of scrollers) {
      const init = this.initialOffsets.get(s);
      let cur = this.currentOffsets.get(s);
      if (!cur) {
        cur = readOffset(s);
        this.currentOffsets.set(s, cur);
      }
      if (init) total = addCoordinates(total, { x: cur.x - init.x, y: cur.y - init.y });
    }
    return total;
  }
}
