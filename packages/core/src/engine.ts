import {
  createDefaultAnnouncements,
  DEFAULT_INSTRUCTIONS,
  defaultGetLabel,
  LiveAnnouncer,
  mountInstructions,
  type AnnouncementContext,
  type Announcements,
} from "./announcer";
import { AutoScroller, type AutoScrollOptions } from "./autoscroll";
import {
  defaultCollisionDetector,
  type Collision,
  type DroppableKind,
  type DroppableSnapshot,
} from "./collision";
import { Emitter } from "./emitter";
import { addCoordinates, subtractCoordinates, toRect, translateRect, ZERO } from "./geometry";
import { GeometryCache, getLayoutRect } from "./measure";
import { applyModifiers } from "./modifiers";
import type { CancelReason, Coordinates, DragData, Rect, UniqueId } from "./primitives";
import { sensorsEqual } from "./sensors/types";
import type {
  ActivationRequest,
  DragSession,
  DropOutcome,
  SensorController,
  SessionTarget,
} from "./sensors/types";
import type { SortableMove } from "./sortable/array";
import {
  SortableCoordinator,
  type SortableContainerConfig,
  type SortableProjection,
} from "./sortable/coordinator";
import { createStore, type Store } from "./store";
import type {
  ActiveInfo,
  DragResult,
  DragState,
  DropContext,
  DropDecision,
  EngineEvents,
  EngineHandlers,
  EngineOptions,
  MotionState,
  OverInfo,
} from "./types";

export const DEFAULT_INSTRUCTIONS_ID = "gripflow-instructions";

export interface DraggableConfig {
  readonly id: UniqueId;
  element?: HTMLElement | null;
  /** Dedicated activator element (drag handle). */
  handle?: HTMLElement | null;
  data?: DragData;
  disabled?: boolean;
}

export interface DroppableConfig {
  readonly id: UniqueId;
  element?: HTMLElement | null;
  data?: DragData;
  disabled?: boolean;
  /** Default `"target"`. Sortable adapters register `"item"` and `"container"`. */
  kind?: DroppableKind;
  /** For `"item"` droppables, the owning container. */
  containerId?: UniqueId;
  /** Excludes this target from detection for dragged items it returns `false` for. */
  accepts?: (active: ActiveInfo) => boolean;
}

export interface Registration<Patch> {
  readonly id: UniqueId;
  update(patch: Patch): void;
  unregister(): void;
}

/** Extension point: a plugin receives the engine and may subscribe, validate and instrument. */
export interface EnginePlugin {
  readonly name: string;
  setup(engine: DragEngine): void | (() => void);
}

type DropValidator = (context: DropContext) => DropDecision | Promise<DropDecision>;

interface DraggableRecord {
  id: UniqueId;
  element: HTMLElement | null;
  handle: HTMLElement | null;
  data: DragData | undefined;
  disabled: boolean;
  unbind: Array<() => void>;
}

interface DroppableRecord {
  id: UniqueId;
  element: HTMLElement | null;
  data: DragData | undefined;
  disabled: boolean;
  kind: DroppableKind;
  containerId: UniqueId | undefined;
  accepts: ((active: ActiveInfo) => boolean) | undefined;
  order: number;
}

interface Session {
  readonly id: UniqueId;
  readonly active: ActiveInfo;
  readonly request: ActivationRequest;
  pointer: Coordinates;
  translate: Coordinates;
  collisions: Collision[];
  candidates: DroppableSnapshot[] | null;
  snapshotCache: Map<UniqueId, { rect: Rect; snapshot: DroppableSnapshot }>;
  move: SortableMove | null;
  decisionKey: string;
  ended: boolean;
  frozen: boolean;
  dropping: boolean;
  dropPromise: Promise<DropOutcome> | null;
  validationToken: number;
  cancelReason: CancelReason | null;
  updateQueued: boolean;
  autoScroller: AutoScroller | null;
  stopWatching: (() => void) | null;
}

const HANDLER_NAMES: { [K in keyof EngineEvents]: keyof EngineHandlers } = {
  activationRequested: "onActivationRequested",
  activationConstraintsSatisfied: "onActivationConstraintsSatisfied",
  dragStart: "onDragStart",
  dragMove: "onDragMove",
  dragOver: "onDragOver",
  dropTargetEnter: "onDropTargetEnter",
  dropTargetLeave: "onDropTargetLeave",
  dropRequested: "onDropRequested",
  dropAccepted: "onDropAccepted",
  dropRejected: "onDropRejected",
  dragEnd: "onDragEnd",
  dragCancel: "onDragCancel",
  error: "onError",
};

const IDLE_STATE: DragState = {
  status: "idle",
  active: null,
  over: null,
  overValid: true,
  rejectionReason: null,
  projection: null,
  lastResult: null,
  settlingId: null,
};

const IDLE_MOTION: MotionState = { translate: ZERO, scrollDelta: ZERO, transform: ZERO, pointer: ZERO };

function normalizeDecision(
  decision: DropDecision,
  fallbackReason: string,
): { ok: boolean; reason: string | null } {
  if (typeof decision === "boolean") return { ok: decision, reason: decision ? null : fallbackReason };
  return { ok: decision.ok, reason: decision.ok ? null : (decision.reason ?? fallbackReason) };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * The framework-independent drag-and-drop engine.
 *
 * It owns transient drag state only. Persistent data stays with the consumer: the engine
 * reports what *would* change (`DragEndEvent.move`) and never mutates application state.
 * One drag runs at a time; additional activations are ignored until it ends.
 */
export class DragEngine {
  /** Low-frequency state: active item, current target, sortable projection. */
  readonly store: Store<DragState> = createStore<DragState>(IDLE_STATE);
  /** High-frequency state: pointer translation. Subscribe narrowly. */
  readonly motion: Store<MotionState> = createStore<MotionState>(IDLE_MOTION);
  readonly sortable = new SortableCoordinator();
  readonly geometry = new GeometryCache();

  private options: EngineOptions;
  private readonly draggables = new Map<UniqueId, DraggableRecord>();
  private readonly droppables = new Map<UniqueId, DroppableRecord>();
  private readonly validators = new Set<DropValidator>();
  private readonly emitter: Emitter<EngineEvents>;
  private session: Session | null = null;
  private mountCount = 0;
  private order = 0;
  private overlayCount = 0;
  private reporting = false;
  private announcer: LiveAnnouncer | null = null;
  private removeInstructions: (() => void) | null = null;
  private idleWaiters: Array<() => void> = [];
  private batch: (fn: () => void) => void = (fn) => fn();

  private readonly controller: SensorController = {
    requestActivation: (id, activator) => this.requestActivation(id, activator),
    activate: (request) => this.activate(request),
    isDragging: () => this.session !== null,
  };

  constructor(options: EngineOptions = {}) {
    this.options = { ...options };
    this.emitter = new Emitter<EngineEvents>(({ event, error }) => this.report(`on:${event}`, error));
  }

  // ---------------------------------------------------------------- configuration

  /** Merges options. Safe to call on every render. */
  setOptions(options: Partial<EngineOptions>): void {
    const previousSensors = this.options.sensors;
    this.options = { ...this.options, ...options };
    if (this.mountCount > 0 && !sensorsEqual(previousSensors, this.options.sensors)) {
      for (const record of this.draggables.values()) this.rebind(record);
    }
  }

  getOptions(): Readonly<EngineOptions> {
    return this.options;
  }

  /**
   * Runs the final "commit" callbacks of an accepted drop inside `batch`, letting a framework
   * adapter flush the consumer's state update and the engine's idle state in a single render.
   */
  setBatch(batch: ((fn: () => void) => void) | null): void {
    this.batch = batch ?? ((fn) => fn());
  }

  getInstructionsId(): string {
    return this.options.accessibility?.instructionsId ?? DEFAULT_INSTRUCTIONS_ID;
  }

  /**
   * Speaks a custom message through the engine's live region. Useful for keyboard fallbacks that
   * change the order without a drag (e.g. "Moved Task 3 up"). No-op while unmounted or when
   * announcements are disabled.
   */
  speak(message: string): void {
    this.announcer?.announce(message);
  }

  /** Subscribe to an engine event. Returns an unsubscribe function. */
  on<K extends keyof EngineEvents>(event: K, listener: (payload: EngineEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }

  /** Adds a drop validator (sync or async). All validators must accept. */
  addDropValidator(validator: DropValidator): () => void {
    this.validators.add(validator);
    return () => {
      this.validators.delete(validator);
    };
  }

  /** Installs a plugin. Returns a function that removes it. */
  use(plugin: EnginePlugin): () => void {
    let cleanup: void | (() => void) = undefined;
    try {
      cleanup = plugin.setup(this);
    } catch (error) {
      this.report(`plugin:${plugin.name}`, error);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (error) {
        this.report(`plugin:${plugin.name}`, error);
      }
    };
  }

  getState(): DragState {
    return this.store.getState();
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Attaches DOM behaviour (sensor listeners, live region). Re-entrant safe and reusable:
   * `mount -> unmount -> mount` (React Strict Mode) works.
   */
  mount(): () => void {
    this.mountCount++;
    if (this.mountCount === 1) {
      for (const record of this.draggables.values()) this.rebind(record);
      this.mountAccessibility();
    }
    let unmounted = false;
    return () => {
      if (unmounted) return;
      unmounted = true;
      this.mountCount = Math.max(0, this.mountCount - 1);
      if (this.mountCount === 0) {
        if (this.session) this.cancel("destroyed");
        for (const record of this.draggables.values()) this.unbindAll(record);
        this.unmountAccessibility();
      }
    };
  }

  /** Cancels any running drag and removes every listener, observer and registration. */
  destroy(): void {
    if (this.session) this.cancel("destroyed");
    for (const record of this.draggables.values()) this.unbindAll(record);
    this.draggables.clear();
    this.droppables.clear();
    this.validators.clear();
    this.emitter.clear();
    this.geometry.dispose();
    this.unmountAccessibility();
    this.mountCount = 0;
  }

  /** Resolves once the engine is idle (no drag, no pending validation). */
  whenIdle(): Promise<void> {
    if (!this.session) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---------------------------------------------------------------- registration

  registerDraggable(config: DraggableConfig): Registration<Partial<Omit<DraggableConfig, "id">>> {
    if (this.options.debug && this.draggables.has(config.id)) {
      console.warn(`[gripflow] draggable id "${String(config.id)}" is registered twice.`);
    }
    const record: DraggableRecord = {
      id: config.id,
      element: config.element ?? null,
      handle: config.handle ?? null,
      data: config.data,
      disabled: config.disabled ?? false,
      unbind: [],
    };
    const previous = this.draggables.get(config.id);
    if (previous) this.unbindAll(previous);
    this.draggables.set(config.id, record);
    if (this.mountCount > 0) this.rebind(record);
    return {
      id: config.id,
      update: (patch) => {
        if (this.draggables.get(config.id) !== record) return;
        const rebind =
          ("element" in patch && patch.element !== record.element) ||
          ("handle" in patch && patch.handle !== record.handle) ||
          ("disabled" in patch && patch.disabled !== record.disabled);
        if ("element" in patch) record.element = patch.element ?? null;
        if ("handle" in patch) record.handle = patch.handle ?? null;
        if ("data" in patch) record.data = patch.data;
        if ("disabled" in patch) record.disabled = patch.disabled ?? false;
        if (rebind && this.mountCount > 0) this.rebind(record);
        if (record.disabled && this.session?.id === record.id) this.cancel("source-disabled");
      },
      unregister: () => {
        if (this.draggables.get(config.id) !== record) return;
        this.unbindAll(record);
        this.draggables.delete(config.id);
        const session = this.session;
        if (session && session.id === config.id) {
          // Frameworks may unmount and immediately re-mount the same id (e.g. when an item
          // moves between parents). Only cancel if it is really gone after the current commit.
          queueMicrotask(() => {
            if (this.session === session && !this.draggables.has(config.id)) {
              this.cancel("source-removed");
            }
          });
        }
      },
    };
  }

  registerDroppable(config: DroppableConfig): Registration<Partial<Omit<DroppableConfig, "id">>> {
    if (this.options.debug && this.droppables.has(config.id)) {
      console.warn(`[gripflow] droppable id "${String(config.id)}" is registered twice.`);
    }
    const record: DroppableRecord = {
      id: config.id,
      element: config.element ?? null,
      data: config.data,
      disabled: config.disabled ?? false,
      kind: config.kind ?? "target",
      containerId: config.containerId,
      accepts: config.accepts,
      order: this.order++,
    };
    this.droppables.set(config.id, record);
    this.onDroppablesChanged(record, "added");
    return {
      id: config.id,
      update: (patch) => {
        if (this.droppables.get(config.id) !== record) return;
        const elementChanged = "element" in patch && patch.element !== record.element;
        if ("element" in patch) record.element = patch.element ?? null;
        if ("data" in patch) record.data = patch.data;
        if ("disabled" in patch) record.disabled = patch.disabled ?? false;
        if ("kind" in patch && patch.kind) record.kind = patch.kind;
        if ("containerId" in patch) record.containerId = patch.containerId;
        if ("accepts" in patch) record.accepts = patch.accepts;
        this.onDroppablesChanged(record, elementChanged ? "element" : "updated");
      },
      unregister: () => {
        if (this.droppables.get(config.id) !== record) return;
        this.droppables.delete(config.id);
        this.onDroppablesChanged(record, "removed");
      },
    };
  }

  /** Registers a sortable container model. Returns an unregister function. */
  registerSortable(config: SortableContainerConfig): () => void {
    const unregister = this.sortable.register(config);
    this.invalidateCandidates();
    this.scheduleUpdate();
    return () => {
      unregister();
      this.invalidateCandidates();
      this.scheduleUpdate();
    };
  }

  /** Forces geometry to be re-measured, e.g. after a virtualizer mounted new rows. */
  refreshGeometry(): void {
    const s = this.session;
    if (!s) return;
    this.geometry.remeasure();
    this.sortable.invalidate();
    this.invalidateCandidates();
    this.update();
  }

  /** Flags that an item is still animating from the overlay into its resting place. */
  setSettling(id: UniqueId | null): void {
    this.store.patch({ settlingId: id });
  }

  /**
   * Called by overlay renderers. While at least one overlay is attached, a finished drag keeps
   * `settlingId` set until the overlay calls `setSettling(null)`, so the source item stays hidden
   * during the drop animation. Returns a detach function.
   */
  attachOverlay(): () => void {
    this.overlayCount++;
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.overlayCount = Math.max(0, this.overlayCount - 1);
      if (this.overlayCount === 0) this.store.patch({ settlingId: null });
    };
  }

  /** The registered elements of a draggable, e.g. to restore focus after a keyboard drop. */
  getDraggableElements(id: UniqueId): { element: HTMLElement | null; handle: HTMLElement | null } | null {
    const record = this.draggables.get(id);
    return record ? { element: record.element, handle: record.handle } : null;
  }

  // ---------------------------------------------------------------- programmatic control

  /** Requests a drop at the current position. Resolves with the outcome. */
  drop(): Promise<DropOutcome> {
    const s = this.session;
    if (!s) return Promise.resolve({ accepted: false, reason: "interrupted" });
    return this.dropSession(s);
  }

  /** Cancels the running operation, if any. Always safe to call. */
  cancel(reason: CancelReason = "programmatic"): void {
    const s = this.session;
    if (!s || s.ended) return;
    s.validationToken++;
    s.cancelReason = reason;
    this.cancelSession(s, reason);
  }

  // ---------------------------------------------------------------- sensors

  private rebind(record: DraggableRecord): void {
    this.unbindAll(record);
    const sensors = this.options.sensors;
    if (!sensors || sensors.length === 0 || !record.element) return;
    const view = {
      id: record.id,
      element: record.element,
      handle: record.handle,
      disabled: record.disabled,
      data: record.data,
    };
    for (const sensor of sensors) {
      try {
        record.unbind.push(sensor.bind(view, this.controller));
      } catch (error) {
        this.report(`sensor:${sensor.name}`, error);
      }
    }
  }

  private unbindAll(record: DraggableRecord): void {
    for (const unbind of record.unbind.splice(0)) {
      try {
        unbind();
      } catch (error) {
        this.report("sensor:unbind", error);
      }
    }
  }

  private requestActivation(id: UniqueId, activator: string): boolean {
    if (this.session) return false;
    const record = this.draggables.get(id);
    if (!record || record.disabled) return false;
    this.emit("activationRequested", { id, activator });
    try {
      if (this.options.canActivate?.({ id, data: record.data, activator }) === false) return false;
    } catch (error) {
      this.report("canActivate", error);
      return false;
    }
    return true;
  }

  private activate(request: ActivationRequest): DragSession | null {
    if (this.session) return null;
    const record = this.draggables.get(request.id);
    if (!record || record.disabled || !record.element) return null;

    this.emit("activationConstraintsSatisfied", { id: request.id, activator: request.activator });

    const element = record.element;
    const active: ActiveInfo = {
      id: request.id,
      data: record.data,
      initialRect: toRect(getLayoutRect(element)),
      origin: request.origin,
      activator: request.activator,
      element,
    };
    const autoScrollOption = this.options.autoScroll;
    const autoScrollConfig: AutoScrollOptions | null =
      autoScrollOption === false || request.autoScroll === false
        ? null
        : typeof autoScrollOption === "object"
          ? autoScrollOption
          : {};
    const session: Session = {
      id: request.id,
      active,
      request,
      pointer: request.origin,
      translate: ZERO,
      collisions: [],
      candidates: null,
      snapshotCache: new Map(),
      move: null,
      decisionKey: "",
      ended: false,
      frozen: false,
      dropping: false,
      dropPromise: null,
      validationToken: 0,
      cancelReason: null,
      updateQueued: false,
      autoScroller:
        autoScrollConfig && autoScrollConfig.enabled !== false
          ? new AutoScroller(autoScrollConfig)
          : null,
      stopWatching: null,
    };
    this.session = session;

    this.geometry.begin(
      [...this.droppables.values()].filter((d) => !d.disabled).map((d) => [d.id, d.element] as const),
    );
    this.geometry.getScrollDelta(element); // capture baseline scroll offsets for the dragged item
    this.sortable.invalidate();
    session.stopWatching = this.geometry.watch(() => this.handleGeometryChange());

    this.store.setState({ ...IDLE_STATE, status: "dragging", active });
    this.motion.setState({ translate: ZERO, scrollDelta: ZERO, transform: ZERO, pointer: request.origin });

    const ok = this.emit("dragStart", { active });
    if (!ok) {
      this.cancelSession(session, "error");
      return null;
    }
    this.announceStart(session);
    this.update();
    return this.createSessionApi(session);
  }

  private createSessionApi(session: Session): DragSession {
    return {
      id: session.id,
      move: (pointer) => {
        if (session.ended || session.frozen) return;
        session.pointer = pointer;
        session.autoScroller?.update(pointer);
        this.update();
      },
      drop: () => this.dropSession(session),
      cancel: (reason = "programmatic") => {
        if (session.ended) return;
        session.validationToken++;
        session.cancelReason = reason;
        this.cancelSession(session, reason);
      },
      isActive: () => !session.ended,
      getPointer: () => session.pointer,
      getActiveRect: () => session.active.initialRect,
      getTargets: () => this.getTargets(session),
      getOverId: () => this.store.getState().over?.id ?? null,
      reveal: (id) => this.reveal(session, id),
    };
  }

  private getTargets(session: Session): readonly SessionTarget[] {
    const candidates = this.ensureCandidates(session);
    const targets: SessionTarget[] = [];
    for (const c of candidates) {
      if (c.id === session.id) continue;
      targets.push({ id: c.id, rect: c.rect, kind: c.kind, containerId: c.containerId });
    }
    return targets;
  }

  private reveal(session: Session, id: UniqueId): Rect | undefined {
    const record = this.droppables.get(id);
    const el = record?.element;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      this.geometry.invalidateScroll();
      this.invalidateCandidates();
      this.sortable.invalidate();
    }
    void session;
    return this.geometry.getRect(id);
  }

  // ---------------------------------------------------------------- core update loop

  private invalidateCandidates(): void {
    if (this.session) this.session.candidates = null;
  }

  private handleGeometryChange(): void {
    if (!this.session) return;
    this.invalidateCandidates();
    this.sortable.invalidate();
    this.update();
  }

  private scheduleUpdate(): void {
    const s = this.session;
    if (!s || s.updateQueued) return;
    s.updateQueued = true;
    queueMicrotask(() => {
      if (this.session === s && !s.ended) this.update();
    });
  }

  private onDroppablesChanged(record: DroppableRecord, change: string): void {
    const s = this.session;
    if (!s) return;
    if (change === "removed") {
      this.geometry.remove(record.id);
    } else if (record.element && !record.disabled) {
      this.geometry.add(record.id, record.element);
    } else {
      this.geometry.remove(record.id);
    }
    this.invalidateCandidates();
    this.sortable.invalidate();
    this.scheduleUpdate();
  }

  private ensureCandidates(session: Session): DroppableSnapshot[] {
    if (session.candidates) return session.candidates;
    const out: DroppableSnapshot[] = [];
    for (const rec of this.droppables.values()) {
      if (rec.disabled || !rec.element) continue;
      const rect = this.geometry.getRect(rec.id);
      if (!rect) continue;
      if (rec.accepts) {
        try {
          if (!rec.accepts(session.active)) continue;
        } catch (error) {
          this.report("accepts", error);
          continue;
        }
      }
      const cached = session.snapshotCache.get(rec.id);
      const depth = this.geometry.getDepth(rec.id);
      if (
        cached &&
        cached.rect === rect &&
        cached.snapshot.kind === rec.kind &&
        cached.snapshot.data === rec.data &&
        cached.snapshot.containerId === rec.containerId &&
        cached.snapshot.depth === depth &&
        cached.snapshot.order === rec.order
      ) {
        out.push(cached.snapshot);
        continue;
      }
      const snapshot: DroppableSnapshot = {
        id: rec.id,
        rect,
        kind: rec.kind,
        containerId: rec.containerId,
        depth,
        order: rec.order,
        data: rec.data,
      };
      session.snapshotCache.set(rec.id, { rect, snapshot });
      out.push(snapshot);
    }
    session.candidates = out;
    return out;
  }

  private update(): void {
    const s = this.session;
    if (!s || s.ended) return;
    s.updateQueued = false;
    const { active } = s;
    const element = this.draggables.get(s.id)?.element ?? active.element;

    const proposed = subtractCoordinates(s.pointer, active.origin);
    const translate = applyModifiers(this.options.modifiers, {
      activeId: active.id,
      activeElement: element,
      transform: proposed,
      activeRect: active.initialRect,
      origin: active.origin,
    });
    s.translate = translate;
    const pointer = addCoordinates(active.origin, translate);
    const collisionRect = translateRect(active.initialRect, translate);
    const scrollDelta = element ? this.geometry.getScrollDelta(element) : ZERO;
    this.motion.setState({
      translate,
      scrollDelta,
      transform: addCoordinates(translate, scrollDelta),
      pointer,
    });

    const candidates = this.ensureCandidates(s);
    const detector = this.options.collisionDetection ?? defaultCollisionDetector;
    let collisions: Collision[] = [];
    try {
      collisions = detector({ activeId: active.id, collisionRect, pointer, droppables: candidates });
    } catch (error) {
      this.report("collisionDetection", error);
    }
    s.collisions = collisions;

    const previous = this.store.getState();
    const top = collisions[0];
    let over: OverInfo | null = null;
    let valid = true;
    let reason: string | null = null;
    let projection: SortableProjection | null = null;
    let move: SortableMove | null = null;

    if (top) {
      const d = top.droppable;
      const prevOver = previous.over;
      over =
        prevOver && prevOver.id === d.id && prevOver.kind === d.kind && prevOver.data === d.data
          ? prevOver
          : { id: d.id, kind: d.kind, containerId: d.containerId, data: d.data };
      projection = this.sortable.project({
        activeId: active.id,
        overId: d.id,
        collisionRect,
        activeRect: active.initialRect,
        getRect: (id) => this.geometry.getRect(id),
      });
      move = projection?.move ?? null;
      const key = `${String(over.id)}|${move ? `${String(move.toContainerId)}:${move.toIndex}` : "-"}`;
      if (key === s.decisionKey && previous.over?.id === over.id) {
        valid = previous.overValid;
        reason = previous.rejectionReason;
      } else {
        const decision = this.evaluateCanDrop({ active, over, move });
        valid = decision.ok;
        reason = decision.reason;
        s.decisionKey = key;
      }
      if (!valid) projection = null;
    } else {
      s.decisionKey = "";
    }
    s.move = move;

    const overChanged = (previous.over?.id ?? null) !== (over?.id ?? null);
    const moveChanged =
      (previous.projection?.move.toContainerId ?? null) !== (projection?.move.toContainerId ?? null) ||
      (previous.projection?.move.toIndex ?? -1) !== (projection?.move.toIndex ?? -1);
    const validityChanged = previous.overValid !== valid;

    this.store.patch({ over, overValid: valid, rejectionReason: reason, projection });

    if (overChanged && previous.over) {
      this.emit("dropTargetLeave", { active, over: previous.over });
    }
    if (overChanged && over) {
      this.emit("dropTargetEnter", { active, over });
    }
    if (overChanged || moveChanged || validityChanged) {
      const event = { active, over, previousOver: previous.over, valid, reason, move };
      this.emit("dragOver", event);
      this.announce((a, ctx) => a.onDragOver(event, ctx));
    }
    if (this.hasHandler("dragMove")) {
      this.emit("dragMove", { active, translate, pointer, over });
    }
  }

  private evaluateCanDrop(context: DropContext): { ok: boolean; reason: string | null } {
    const canDrop = this.options.canDrop;
    if (!canDrop || context.over?.id === context.active.id) return { ok: true, reason: null };
    try {
      return normalizeDecision(canDrop(context), "not-allowed");
    } catch (error) {
      this.report("canDrop", error);
      return { ok: false, reason: "error" };
    }
  }

  // ---------------------------------------------------------------- ending an operation

  private dropSession(s: Session): Promise<DropOutcome> {
    if (s.ended) return Promise.resolve({ accepted: false, reason: s.cancelReason ?? "interrupted" });
    if (s.dropPromise) return s.dropPromise;
    s.dropping = true;
    s.dropPromise = this.performDrop(s);
    return s.dropPromise;
  }

  private async performDrop(s: Session): Promise<DropOutcome> {
    this.update();
    const state = this.store.getState();
    const { active } = s;
    const over = state.over;
    const move = s.move;

    if (!over && !this.options.allowDropWithoutTarget) {
      s.cancelReason = "no-target";
      this.cancelSession(s, "no-target");
      return { accepted: false, reason: "no-target" };
    }
    if (over && !state.overValid) {
      return this.reject(s, state.rejectionReason ?? "not-allowed", over, move);
    }

    const context: DropContext = { active, over, move };
    this.emit("dropRequested", context);
    const token = ++s.validationToken;

    const validators: DropValidator[] = [];
    if (this.options.validateDrop) validators.push(this.options.validateDrop);
    validators.push(...this.validators);

    for (const validate of validators) {
      let result: DropDecision | Promise<DropDecision>;
      try {
        result = validate(context);
        if (isThenable(result)) {
          s.frozen = true;
          s.autoScroller?.stop();
          this.store.patch({ status: "validating" });
          result = await result;
        }
      } catch (error) {
        this.report("validateDrop", error);
        if (s.ended || token !== s.validationToken) {
          return { accepted: false, reason: s.cancelReason ?? "interrupted" };
        }
        return this.reject(s, "error", over, move);
      }
      if (s.ended || token !== s.validationToken) {
        return { accepted: false, reason: s.cancelReason ?? "interrupted" };
      }
      const verdict = normalizeDecision(result, "rejected");
      if (!verdict.ok) return this.reject(s, verdict.reason ?? "rejected", over, move);
    }

    this.emit("dropAccepted", context);
    this.announce((a, ctx) =>
      a.onDragEnd({ active, over, move, translate: s.translate }, ctx),
    );
    const result: DragResult = {
      type: "dropped",
      active,
      over,
      move,
      translate: s.translate,
      reason: null,
    };
    this.batch(() => {
      this.emit("dragEnd", { active, over, move, translate: s.translate });
      this.finalize(s, result);
    });
    return { accepted: true };
  }

  private reject(s: Session, reason: string, over: OverInfo | null, move: SortableMove | null): DropOutcome {
    const event = { active: s.active, over, move, reason };
    this.emit("dropRejected", event);
    this.announce((a, ctx) => a.onDropRejected(event, ctx));
    s.cancelReason = "rejected";
    this.cancelSession(s, "rejected");
    return { accepted: false, reason: "rejected" };
  }

  private cancelSession(s: Session, reason: CancelReason): void {
    if (s.ended) return;
    const state = this.store.getState();
    const event = { active: s.active, over: state.over, reason };
    this.emit("dragCancel", event);
    this.announce((a, ctx) => a.onDragCancel(event, ctx));
    this.finalize(s, {
      type: "cancelled",
      active: s.active,
      over: state.over,
      move: s.move,
      translate: s.translate,
      reason,
    });
  }

  private finalize(s: Session, result: DragResult): void {
    if (s.ended) return;
    s.ended = true;
    s.autoScroller?.stop();
    s.stopWatching?.();
    this.geometry.dispose();
    try {
      s.request.onEnd();
    } catch (error) {
      this.report("sensor:onEnd", error);
    }
    this.session = null;
    this.sortable.invalidate();
    this.store.setState({
      ...IDLE_STATE,
      lastResult: result,
      settlingId: this.overlayCount > 0 ? result.active.id : null,
    });
    this.motion.setState(IDLE_MOTION);
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  // ---------------------------------------------------------------- events, errors, a11y

  private hasHandler(event: keyof EngineEvents): boolean {
    return this.options[HANDLER_NAMES[event]] !== undefined || this.emitter.has(event);
  }

  /** Emits to the option handler and subscribers. Returns `false` if any of them threw. */
  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): boolean {
    if (event === "error") return true;
    let ok = true;
    const handler = this.options[HANDLER_NAMES[event]] as
      | ((payload: EngineEvents[K]) => void)
      | undefined;
    if (handler) {
      try {
        handler(payload);
      } catch (error) {
        ok = false;
        this.report(HANDLER_NAMES[event], error);
      }
    }
    if (this.emitter.emit(event, payload).length > 0) ok = false;
    return ok;
  }

  private report(phase: string, error: unknown): void {
    if (this.reporting) return;
    this.reporting = true;
    try {
      const handled = this.options.onError !== undefined || this.emitter.has("error");
      const event = { phase, error };
      try {
        this.options.onError?.(event);
      } catch {
        /* an error handler must never break the engine */
      }
      this.emitter.emit("error", event);
      if (!handled) console.error(`[gripflow] error in ${phase}:`, error);
    } finally {
      this.reporting = false;
    }
  }

  private a11y(): { announcements: Announcements | null; context: AnnouncementContext } {
    const cfg = this.options.accessibility;
    const getLabel = cfg?.getLabel ?? defaultGetLabel;
    const defaults = createDefaultAnnouncements();
    const announcements =
      cfg?.announcements === false ? null : { ...defaults, ...(cfg?.announcements ?? {}) };
    return {
      announcements,
      context: { getLabel, projection: this.store.getState().projection },
    };
  }

  private announce(build: (a: Announcements, ctx: AnnouncementContext) => string | null | undefined): void {
    if (!this.announcer) return;
    const { announcements, context } = this.a11y();
    if (!announcements) return;
    try {
      const message = build(announcements, context);
      if (message) this.announcer.announce(message);
    } catch (error) {
      this.report("announcements", error);
    }
  }

  private announceStart(session: Session): void {
    const event = { active: session.active };
    this.announce((a, ctx) => a.onDragStart(event, ctx));
  }

  private mountAccessibility(): void {
    if (typeof document === "undefined") return;
    const cfg = this.options.accessibility;
    if (cfg?.announcements !== false && !this.announcer) {
      this.announcer = new LiveAnnouncer(document, cfg?.politeness ?? "assertive");
    }
    const instructions = cfg?.instructions ?? DEFAULT_INSTRUCTIONS;
    if (instructions !== false && !this.removeInstructions) {
      this.removeInstructions = mountInstructions(document, this.getInstructionsId(), instructions);
    }
  }

  private unmountAccessibility(): void {
    this.announcer?.destroy();
    this.announcer = null;
    this.removeInstructions?.();
    this.removeInstructions = null;
  }
}
