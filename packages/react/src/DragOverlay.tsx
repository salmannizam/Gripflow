import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { resolveAnimation, type ActiveInfo } from "@gripflow/core";
import { useDragDropContext } from "./context";
import { useIsomorphicLayoutEffect, useStoreSelector } from "./store-hooks";

export interface DropAnimationOptions {
  /** Milliseconds. Defaults to the provider's `animation.duration`. */
  duration?: number;
  /** Any CSS easing. Defaults to the provider's `animation.easing`. */
  easing?: string;
}

export interface DragOverlayProps {
  /** What to render while dragging. A function receives the active item's info. */
  children?: ReactNode | ((active: ActiveInfo) => ReactNode);
  className?: string;
  /** Merged over the structural styles (`position`, `transform`, size). Avoid overriding those. */
  style?: CSSProperties;
  /** Portal target. Default `document.body`. */
  container?: HTMLElement | null;
  /** `zIndex` of the overlay layer. Default `1000`. */
  zIndex?: number;
  /** Customize or disable (`false`) the settle animation after a drop or cancel. */
  dropAnimation?: false | DropAnimationOptions;
  /** Size the overlay like the dragged item. Default `true`; disable for custom-sized previews. */
  matchSize?: boolean;
}

function toTranslate(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`;
}

/**
 * Renders a movable preview of the active item in a portal. While an overlay is mounted the
 * in-flow item no longer receives the drag transform, so layouts stay stable and the preview
 * can leave clipping/overflow containers. The overlay follows the pointer by writing the
 * transform straight to the DOM (no React render per pointer move) and animates to the item's
 * final position after a drop, or back after a cancel.
 */
export function DragOverlay({
  children,
  className,
  style,
  container,
  zIndex = 1000,
  dropAnimation,
  matchSize = true,
}: DragOverlayProps): ReactNode {
  const { engine, overlay } = useDragDropContext("DragOverlay");
  const active = useStoreSelector(engine.store, (s) => s.active);
  const [retained, setRetained] = useState<ActiveInfo | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const dropAnimationRef = useRef(dropAnimation);
  dropAnimationRef.current = dropAnimation;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  // Tell the engine and the draggables that an overlay renders the moving visual.
  useEffect(() => {
    const detach = engine.attachOverlay();
    overlay.patch({ count: overlay.getState().count + 1 });
    return () => {
      detach();
      overlay.patch({ count: Math.max(0, overlay.getState().count - 1) });
    };
  }, [engine, overlay]);

  const shown = active ?? retained;
  const shownId = shown?.id ?? null;

  // Remember the last active item so the preview stays up during the settle animation.
  useIsomorphicLayoutEffect(() => {
    if (active) setRetained(active);
  }, [active]);

  // Follow the pointer without re-rendering.
  useIsomorphicLayoutEffect(() => {
    const el = elementRef.current;
    if (!active || !el) return;
    const apply = () => {
      const { translate } = engine.motion.getState();
      el.style.transform = toTranslate(
        Math.round(active.initialRect.left + translate.x),
        Math.round(active.initialRect.top + translate.y),
      );
    };
    animationRef.current?.cancel();
    animationRef.current = null;
    apply();
    return engine.motion.subscribe(apply);
  }, [engine, active, portalReady]);

  const finishSettle = useCallback(
    (id: ActiveInfo["id"]) => {
      animationRef.current = null;
      setRetained((current) => (current?.id === id ? null : current));
      if (engine.store.getState().settlingId === id) engine.setSettling(null);
    },
    [engine],
  );

  // Settle: animate from where the drop happened to where the item now lives.
  useIsomorphicLayoutEffect(() => {
    if (active || !retained) return;
    const id = retained.id;
    const el = elementRef.current;
    const state = engine.store.getState();
    if (!el || state.settlingId !== id) {
      finishSettle(id);
      return;
    }
    const resolved = resolveAnimation(engine.getOptions().animation);
    const dropAnimationOption = dropAnimationRef.current;
    const custom = dropAnimationOption === false ? null : dropAnimationOption;
    const duration = custom?.duration ?? resolved.duration;
    const easing = custom?.easing ?? resolved.easing;
    const targetEl = engine.getDraggableElements(id)?.element ?? null;
    if (
      dropAnimationOption === false ||
      !resolved.enabled ||
      duration <= 0 ||
      !targetEl ||
      typeof el.animate !== "function"
    ) {
      finishSettle(id);
      return;
    }
    const target = targetEl.getBoundingClientRect();
    const from = el.style.transform || toTranslate(retained.initialRect.left, retained.initialRect.top);
    const to = toTranslate(Math.round(target.left), Math.round(target.top));
    const animation = el.animate([{ transform: from }, { transform: to }], {
      duration,
      easing,
      fill: "forwards",
    });
    animationRef.current = animation;
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      finishSettle(id);
    };
    animation.addEventListener("finish", complete);
    animation.addEventListener("cancel", complete);
    return () => {
      animation.removeEventListener("finish", complete);
      animation.removeEventListener("cancel", complete);
      animation.cancel();
      complete();
    };
  }, [engine, active, retained, finishSettle]);

  if (!portalReady || typeof document === "undefined") return null;
  const target = container ?? document.body;
  const settling = !active && shown !== null;

  return createPortal(
    shown ? (
      <div
        ref={elementRef}
        aria-hidden="true"
        className={className}
        data-gripflow-overlay=""
        data-dropping={settling ? "" : undefined}
        data-active-id={String(shownId)}
        style={{
          ...style,
          position: "fixed",
          top: 0,
          left: 0,
          zIndex,
          pointerEvents: "none",
          willChange: "transform",
          ...(matchSize ? { width: shown.initialRect.width, height: shown.initialRect.height } : null),
        }}
      >
        {typeof children === "function" ? children(shown) : children}
      </div>
    ) : null,
    target,
  );
}
