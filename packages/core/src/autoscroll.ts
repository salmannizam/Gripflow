import type { Coordinates, Rect } from "./primitives";
import { isScrollable } from "./measure";

export interface AutoScrollOptions {
  /** Default `true`. */
  enabled?: boolean;
  /** Edge zone size as a fraction of the container (0-0.5). Default `0.2`. */
  threshold?: number;
  /** Upper bound for the zone in pixels. Default `120`. */
  maxThreshold?: number;
  /** Lower bound for the zone in pixels. Default `24`. */
  minThreshold?: number;
  /** Top speed in pixels per second. Default `1200`. */
  maxSpeed?: number;
  /** Exponent shaping the speed ramp; `1` is linear, larger ramps slower. Default `2`. */
  acceleration?: number;
  /** Restrict scrolling to an axis. Default `"both"`. */
  axis?: "both" | "x" | "y";
  /** Veto individual scroll containers (the window is passed as `window`). */
  canScroll?: (scroller: Element | Window) => boolean;
}

export interface EdgeVelocityInput {
  /** Pointer coordinate on the axis. */
  position: number;
  /** Start of the scroll container on the axis. */
  start: number;
  /** End of the scroll container on the axis. */
  end: number;
  threshold: number;
  maxSpeed: number;
  acceleration: number;
}

/**
 * Pure velocity calculation (px/second). Negative scrolls towards the start of the axis.
 * Speed ramps from 0 at the inner edge of the zone to `maxSpeed` at (or beyond) the container edge.
 */
export function computeEdgeVelocity(input: EdgeVelocityInput): number {
  const { position, start, end, threshold, maxSpeed, acceleration } = input;
  if (threshold <= 0) return 0;
  if (position < start + threshold) {
    const ratio = Math.min(1, (start + threshold - position) / threshold);
    return -maxSpeed * Math.pow(ratio, acceleration);
  }
  if (position > end - threshold) {
    const ratio = Math.min(1, (position - (end - threshold)) / threshold);
    return maxSpeed * Math.pow(ratio, acceleration);
  }
  return 0;
}

function isWindow(s: Element | Window): s is Window {
  return (s as Window).window === s;
}

function viewportRect(): Rect {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { left: 0, top: 0, right: w, bottom: h, width: w, height: h };
}

function canScrollOn(scroller: Element | Window, axis: "x" | "y", direction: 1 | -1): boolean {
  const el = isWindow(scroller) ? document.scrollingElement : scroller;
  if (!el) return false;
  if (axis === "y") {
    const max = el.scrollHeight - el.clientHeight;
    return direction < 0 ? el.scrollTop > 0 : el.scrollTop < max - 1;
  }
  const max = el.scrollWidth - el.clientWidth;
  return direction < 0 ? el.scrollLeft > 0 : el.scrollLeft < max - 1;
}

function scrollParents(from: Element | null): (Element | Window)[] {
  const chain: (Element | Window)[] = [];
  let el: Element | null = from;
  while (el && el !== document.body && el !== document.documentElement) {
    if (isScrollable(el)) chain.push(el);
    el = el.parentElement;
  }
  chain.push(window);
  return chain;
}

/**
 * Scrolls window and nested containers while the pointer sits in their edge zones.
 * Uses a frame loop with real elapsed time so speed is independent of refresh rate.
 */
export class AutoScroller {
  private frame = 0;
  private pointer: Coordinates | null = null;
  private lastTime = 0;
  private readonly options: Required<Omit<AutoScrollOptions, "canScroll">> &
    Pick<AutoScrollOptions, "canScroll">;

  constructor(options: AutoScrollOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      threshold: Math.min(0.5, Math.max(0, options.threshold ?? 0.2)),
      maxThreshold: options.maxThreshold ?? 120,
      minThreshold: options.minThreshold ?? 24,
      maxSpeed: options.maxSpeed ?? 1200,
      acceleration: options.acceleration ?? 2,
      axis: options.axis ?? "both",
      canScroll: options.canScroll,
    };
  }

  /** Feed the latest pointer position; starts the loop when needed. */
  update(pointer: Coordinates): void {
    if (!this.options.enabled || typeof requestAnimationFrame === "undefined") return;
    this.pointer = pointer;
    if (this.frame === 0) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  stop(): void {
    if (this.frame !== 0 && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = 0;
    this.pointer = null;
  }

  private readonly tick = (time: number): void => {
    this.frame = 0;
    const pointer = this.pointer;
    if (!pointer) return;
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    const scrolled = this.scrollOnce(pointer, dt);
    // Keep looping while the pointer is in a zone, even if this frame could not scroll yet.
    if (scrolled || this.isInAnyZone(pointer)) {
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private zone(size: number): number {
    const { threshold, minThreshold, maxThreshold } = this.options;
    return Math.min(size / 2, Math.min(maxThreshold, Math.max(minThreshold, size * threshold)));
  }

  private chainAt(pointer: Coordinates): (Element | Window)[] {
    const at =
      typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(pointer.x, pointer.y)
        : null;
    return scrollParents(at);
  }

  private isInAnyZone(pointer: Coordinates): boolean {
    for (const scroller of this.chainAt(pointer)) {
      const rect = isWindow(scroller) ? viewportRect() : scroller.getBoundingClientRect();
      const vx = computeEdgeVelocity({
        position: pointer.x,
        start: rect.left,
        end: rect.right,
        threshold: this.zone(rect.width),
        maxSpeed: 1,
        acceleration: 1,
      });
      const vy = computeEdgeVelocity({
        position: pointer.y,
        start: rect.top,
        end: rect.bottom,
        threshold: this.zone(rect.height),
        maxSpeed: 1,
        acceleration: 1,
      });
      if ((vx !== 0 && this.options.axis !== "y") || (vy !== 0 && this.options.axis !== "x")) {
        return true;
      }
    }
    return false;
  }

  private scrollOnce(pointer: Coordinates, dt: number): boolean {
    const { axis, maxSpeed, acceleration, canScroll } = this.options;
    let movedX = false;
    let movedY = false;
    let dxTotal = 0;
    let dyTotal = 0;
    for (const scroller of this.chainAt(pointer)) {
      if (canScroll && !canScroll(scroller)) continue;
      const rect = isWindow(scroller) ? viewportRect() : scroller.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (!movedX && axis !== "y") {
        const v = computeEdgeVelocity({
          position: pointer.x,
          start: rect.left,
          end: rect.right,
          threshold: this.zone(rect.width),
          maxSpeed,
          acceleration,
        });
        if (v !== 0 && canScrollOn(scroller, "x", v < 0 ? -1 : 1)) {
          dx = v * dt;
          movedX = true;
        }
      }
      if (!movedY && axis !== "x") {
        const v = computeEdgeVelocity({
          position: pointer.y,
          start: rect.top,
          end: rect.bottom,
          threshold: this.zone(rect.height),
          maxSpeed,
          acceleration,
        });
        if (v !== 0 && canScrollOn(scroller, "y", v < 0 ? -1 : 1)) {
          dy = v * dt;
          movedY = true;
        }
      }
      if (dx !== 0 || dy !== 0) {
        dxTotal += dx;
        dyTotal += dy;
        scroller.scrollBy({ left: dx, top: dy, behavior: "instant" });
      }
      if (movedX && movedY) break;
    }
    return (movedX && dxTotal !== 0) || (movedY && dyTotal !== 0);
  }
}
