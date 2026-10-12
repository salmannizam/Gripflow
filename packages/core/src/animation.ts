/** Animation settings shared by sortable items, the drag overlay and drop animation. */
export interface AnimationOptions {
  /**
   * `true` always animates, `false` never animates, `"auto"` (default) animates unless the
   * user prefers reduced motion.
   */
  enabled?: boolean | "auto";
  /** Milliseconds. Default `200`. */
  duration?: number;
  /** Any CSS easing function. Default `"cubic-bezier(0.2, 0, 0, 1)"`. */
  easing?: string;
}

export interface ResolvedAnimation {
  readonly enabled: boolean;
  readonly duration: number;
  readonly easing: string;
}

export const DEFAULT_ANIMATION_DURATION = 200;
export const DEFAULT_ANIMATION_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/** Browser-safe check of `prefers-reduced-motion: reduce`. `false` on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function resolveAnimation(
  options: AnimationOptions | undefined,
  reducedMotion: boolean = prefersReducedMotion(),
): ResolvedAnimation {
  const mode = options?.enabled ?? "auto";
  const enabled = mode === "auto" ? !reducedMotion : mode;
  return {
    enabled,
    duration: enabled ? Math.max(0, options?.duration ?? DEFAULT_ANIMATION_DURATION) : 0,
    easing: options?.easing ?? DEFAULT_ANIMATION_EASING,
  };
}

/** CSS `transition` value for an animated property, or `undefined` when animations are off. */
export function transitionFor(
  animation: ResolvedAnimation,
  property: string = "transform",
): string | undefined {
  return animation.enabled && animation.duration > 0
    ? `${property} ${animation.duration}ms ${animation.easing}`
    : undefined;
}
