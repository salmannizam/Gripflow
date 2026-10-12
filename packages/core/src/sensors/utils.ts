/** Default selector of elements inside a draggable that must keep their native behaviour. */
export const DEFAULT_INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "option",
  "label",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='menuitem']",
  "[role='textbox']",
  "[role='slider']",
  "[data-gripflow-ignore]",
].join(",");

/**
 * Whether `target` is (inside) an interactive control located *within* `boundary`.
 * The boundary itself is never considered interactive, so a `<button>` used as a drag
 * handle still works.
 */
export function isInteractiveTarget(
  target: EventTarget | null,
  boundary: Element,
  selector: string = DEFAULT_INTERACTIVE_SELECTOR,
): boolean {
  let el: Element | null = target instanceof Element ? target : null;
  while (el && el !== boundary) {
    if (el.matches(selector)) return true;
    el = el.parentElement;
  }
  return false;
}

export function noop(): void {
  /* intentionally empty */
}
