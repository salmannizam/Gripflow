import type { CollisionDetector, DroppableKind } from "./collision";
import type { Modifier } from "./modifiers";
import type {
  ActivatorKind,
  CancelReason,
  Coordinates,
  DragData,
  Rect,
  UniqueId,
} from "./primitives";
import type { Sensor } from "./sensors/types";
import type { SortableMove } from "./sortable/array";
import type { SortableProjection } from "./sortable/coordinator";
import type { AutoScrollOptions } from "./autoscroll";
import type { AccessibilityOptions } from "./announcer";
import type { AnimationOptions } from "./animation";

/** Describes the item being dragged. */
export interface ActiveInfo {
  readonly id: UniqueId;
  readonly data: DragData | undefined;
  /** Layout rect at activation time (viewport coordinates, transform-free). */
  readonly initialRect: Rect;
  /** Pointer (or virtual keyboard pointer) at activation time. */
  readonly origin: Coordinates;
  readonly activator: ActivatorKind;
  readonly element: HTMLElement | null;
}

/** Describes the drop target currently under the dragged item. */
export interface OverInfo {
  readonly id: UniqueId;
  readonly kind: DroppableKind;
  readonly containerId: UniqueId | undefined;
  readonly data: DragData | undefined;
}

export interface ActivationRequestedEvent {
  readonly id: UniqueId;
  readonly activator: ActivatorKind;
}
export interface ActivationConstraintsSatisfiedEvent {
  readonly id: UniqueId;
  readonly activator: ActivatorKind;
}
export interface DragStartEvent {
  readonly active: ActiveInfo;
}
export interface DragMoveEvent {
  readonly active: ActiveInfo;
  readonly translate: Coordinates;
  readonly pointer: Coordinates;
  readonly over: OverInfo | null;
}
export interface DragOverEvent {
  readonly active: ActiveInfo;
  readonly over: OverInfo | null;
  readonly previousOver: OverInfo | null;
  /** False when the target exists but the drop would be rejected. */
  readonly valid: boolean;
  readonly reason: string | null;
  readonly move: SortableMove | null;
}
export interface DropTargetEvent {
  readonly active: ActiveInfo;
  readonly over: OverInfo;
}
export interface DropRequestedEvent {
  readonly active: ActiveInfo;
  readonly over: OverInfo | null;
  readonly move: SortableMove | null;
}
export interface DropAcceptedEvent extends DropRequestedEvent {}
export interface DropRejectedEvent extends DropRequestedEvent {
  readonly reason: string;
}
export interface DragEndEvent {
  readonly active: ActiveInfo;
  /** `null` only when `allowDropWithoutTarget` is enabled. */
  readonly over: OverInfo | null;
  /** The sortable move, when the drop happened on a sortable item/container. */
  readonly move: SortableMove | null;
  readonly translate: Coordinates;
}
export interface DragCancelEvent {
  readonly active: ActiveInfo;
  readonly over: OverInfo | null;
  readonly reason: CancelReason;
}
export interface EngineErrorEvent {
  /** Where the error was caught, e.g. `"onDragStart"`, `"canDrop"`. */
  readonly phase: string;
  readonly error: unknown;
}

/** Everything the engine can emit, keyed by event name. */
export interface EngineEvents {
  activationRequested: ActivationRequestedEvent;
  activationConstraintsSatisfied: ActivationConstraintsSatisfiedEvent;
  dragStart: DragStartEvent;
  dragMove: DragMoveEvent;
  dragOver: DragOverEvent;
  dropTargetEnter: DropTargetEvent;
  dropTargetLeave: DropTargetEvent;
  dropRequested: DropRequestedEvent;
  dropAccepted: DropAcceptedEvent;
  dropRejected: DropRejectedEvent;
  dragEnd: DragEndEvent;
  dragCancel: DragCancelEvent;
  error: EngineErrorEvent;
}

/** The same events as optional `onXxx` callbacks, convenient for configuration. */
export interface EngineHandlers {
  onActivationRequested?(event: ActivationRequestedEvent): void;
  onActivationConstraintsSatisfied?(event: ActivationConstraintsSatisfiedEvent): void;
  onDragStart?(event: DragStartEvent): void;
  onDragMove?(event: DragMoveEvent): void;
  onDragOver?(event: DragOverEvent): void;
  onDropTargetEnter?(event: DropTargetEvent): void;
  onDropTargetLeave?(event: DropTargetEvent): void;
  onDropRequested?(event: DropRequestedEvent): void;
  onDropAccepted?(event: DropAcceptedEvent): void;
  onDropRejected?(event: DropRejectedEvent): void;
  onDragEnd?(event: DragEndEvent): void;
  onDragCancel?(event: DragCancelEvent): void;
  onError?(event: EngineErrorEvent): void;
}

/** A synchronous or asynchronous verdict about a drop. */
export type DropDecision = boolean | { readonly ok: boolean; readonly reason?: string };

export interface DropContext {
  readonly active: ActiveInfo;
  readonly over: OverInfo | null;
  readonly move: SortableMove | null;
}

export interface ActivationContext {
  readonly id: UniqueId;
  readonly data: DragData | undefined;
  readonly activator: ActivatorKind;
}

/** Engine configuration. All fields are optional; defaults are documented per field. */
export interface EngineOptions extends EngineHandlers {
  /** Input sensors. Default: none - the React package supplies pointer and keyboard sensors. */
  sensors?: readonly Sensor[];
  /** Default: {@link defaultCollisionDetector} (container-aware, pointer first). */
  collisionDetection?: CollisionDetector;
  /** Movement modifiers applied in order. */
  modifiers?: readonly Modifier[];
  /** Pass `false` to disable. Default: enabled for pointer sensors. */
  autoScroll?: AutoScrollOptions | boolean;
  animation?: AnimationOptions;
  accessibility?: AccessibilityOptions;
  /** Synchronous veto of activation. */
  canActivate?(context: ActivationContext): boolean;
  /**
   * Synchronous check evaluated on every target change. A `false` verdict marks the target
   * as invalid: the UI can show feedback and a drop there is rejected.
   */
  canDrop?(context: DropContext): DropDecision;
  /** Evaluated once on release; may be async (e.g. a server permission check). */
  validateDrop?(context: DropContext): DropDecision | Promise<DropDecision>;
  /** Treat a release over no target as an accepted drop with `over: null`. Default: cancel. */
  allowDropWithoutTarget?: boolean;
  /** Extra diagnostics in the console (duplicate ids etc). Default `false`. */
  debug?: boolean;
}

/** Result of a finished operation, retained so overlays can animate the settle phase. */
export interface DragResult {
  readonly type: "dropped" | "cancelled";
  readonly active: ActiveInfo;
  readonly over: OverInfo | null;
  readonly move: SortableMove | null;
  readonly translate: Coordinates;
  readonly reason: CancelReason | null;
}

export type DragStatus = "idle" | "dragging" | "validating";

/** Low-frequency, structural drag state. */
export interface DragState {
  readonly status: DragStatus;
  readonly active: ActiveInfo | null;
  readonly over: OverInfo | null;
  /** `false` when `over` exists but the drop would be rejected. */
  readonly overValid: boolean;
  readonly rejectionReason: string | null;
  /** Sortable displacement for siblings, when dragging a sortable item over a sortable target. */
  readonly projection: SortableProjection | null;
  readonly lastResult: DragResult | null;
  /** Id of an item whose overlay is still animating to its resting place. */
  readonly settlingId: UniqueId | null;
}

/** High-frequency pointer state. Subscribe narrowly (overlay, active item). */
export interface MotionState {
  /** Pointer movement since activation after modifiers, in viewport coordinates. */
  readonly translate: Coordinates;
  /** How far scroll containers of the dragged element have scrolled since activation. */
  readonly scrollDelta: Coordinates;
  /** `translate + scrollDelta`: apply this to the in-flow dragged element. */
  readonly transform: Coordinates;
  readonly pointer: Coordinates;
}
