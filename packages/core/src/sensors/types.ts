import type {
  ActivatorKind,
  CancelReason,
  Coordinates,
  DragData,
  Rect,
  UniqueId,
} from "../primitives";
import type { DroppableKind } from "../collision";

/** A draggable as seen by a sensor when binding input listeners. */
export interface SensorDraggable {
  readonly id: UniqueId;
  /** The draggable element. `null` until the framework adapter attaches it. */
  readonly element: HTMLElement | null;
  /** Optional dedicated activator (drag handle). When set, only it starts drags. */
  readonly handle: HTMLElement | null;
  readonly disabled: boolean;
  readonly data: DragData | undefined;
}

/** A drop target the keyboard (or a custom sensor) can navigate to. */
export interface SessionTarget {
  readonly id: UniqueId;
  readonly rect: Rect;
  readonly kind: DroppableKind;
  readonly containerId: UniqueId | undefined;
}

/** Handle to a running drag. Sensors feed pointer positions in and end the drag. */
export interface DragSession {
  readonly id: UniqueId;
  /** Feed the pointer position in viewport coordinates. Ignored once the drag has ended. */
  move(pointer: Coordinates): void;
  /** Request a drop at the current position. Resolves when the outcome is known. */
  drop(): Promise<DropOutcome>;
  cancel(reason?: CancelReason): void;
  isActive(): boolean;
  getPointer(): Coordinates;
  getActiveRect(): Rect;
  /** Currently navigable targets, excluding the dragged item itself. */
  getTargets(): readonly SessionTarget[];
  /** Id of the target under the dragged item, if any. */
  getOverId(): UniqueId | null;
  /** Scrolls a target into view and returns its refreshed rect. */
  reveal(id: UniqueId): Rect | undefined;
}

export interface DropOutcome {
  readonly accepted: boolean;
  readonly reason?: CancelReason;
}

export interface ActivationRequest {
  readonly id: UniqueId;
  readonly activator: ActivatorKind;
  /** Pointer position (viewport) where the interaction started. */
  readonly origin: Coordinates;
  /** Set `false` for non-pointer sensors so edge auto-scrolling is not applied. */
  readonly autoScroll?: boolean;
  /** Called exactly once when the drag ends for any reason; remove listeners here. */
  readonly onEnd: () => void;
}

/** The only door through which a sensor talks to the engine. */
export interface SensorController {
  /** Emits `activationRequested` and applies `canActivate`. Returns `false` to ignore the input. */
  requestActivation(id: UniqueId, activator: ActivatorKind): boolean;
  /** Starts the drag. Returns `null` when a drag is already running or the item is unavailable. */
  activate(request: ActivationRequest): DragSession | null;
  isDragging(): boolean;
}

/**
 * Input source. `bind` attaches activation listeners to one draggable and returns a function
 * that removes them. Cleanup of an *active* drag is owned by `ActivationRequest.onEnd`.
 */
export interface Sensor<Options extends object = object> {
  readonly name: string;
  /** Serializable-ish options; used to avoid re-binding when an equal sensor is passed again. */
  readonly options: Options;
  bind(draggable: SensorDraggable, controller: SensorController): () => void;
}

export function sensorsEqual(a: readonly Sensor[] | undefined, b: readonly Sensor[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((sensor, i) => {
    const other = b[i];
    if (!other || sensor.name !== other.name) return false;
    const keys = new Set([...Object.keys(sensor.options), ...Object.keys(other.options)]);
    for (const key of keys) {
      const l = (sensor.options as Record<string, unknown>)[key];
      const r = (other.options as Record<string, unknown>)[key];
      if (!shallowOptionEqual(l, r)) return false;
    }
    return true;
  });
}

function shallowOptionEqual(l: unknown, r: unknown): boolean {
  if (Object.is(l, r)) return true;
  if (typeof l === "object" && typeof r === "object" && l !== null && r !== null) {
    const lk = Object.keys(l);
    const rk = Object.keys(r);
    return (
      lk.length === rk.length &&
      lk.every((k) =>
        Object.is((l as Record<string, unknown>)[k], (r as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}
