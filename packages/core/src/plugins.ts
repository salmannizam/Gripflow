import type { DragEngine, EnginePlugin } from "./engine";
import type { EngineEvents } from "./types";

export interface LogEntry {
  readonly time: number;
  readonly event: keyof EngineEvents;
  readonly detail: string;
}

export interface LoggerPluginOptions {
  /** Receives every entry. Default: keeps entries in memory only. */
  log?: (entry: LogEntry) => void;
  /** Maximum entries retained in memory. Default `200`. */
  limit?: number;
  /** Events to record. Default: every event except `dragMove`. */
  events?: readonly (keyof EngineEvents)[];
}

export interface LoggerPlugin extends EnginePlugin {
  /** Entries recorded so far (oldest first). */
  getEntries(): readonly LogEntry[];
  clear(): void;
}

const DEFAULT_EVENTS: readonly (keyof EngineEvents)[] = [
  "activationRequested",
  "activationConstraintsSatisfied",
  "dragStart",
  "dragOver",
  "dropTargetEnter",
  "dropTargetLeave",
  "dropRequested",
  "dropAccepted",
  "dropRejected",
  "dragEnd",
  "dragCancel",
  "error",
];

function describe(event: keyof EngineEvents, payload: unknown): string {
  const p = payload as Record<string, unknown> & {
    active?: { id: unknown };
    over?: { id: unknown } | null;
    id?: unknown;
  };
  const parts: string[] = [];
  if (p.active) parts.push(`active=${String(p.active.id)}`);
  else if (p.id !== undefined) parts.push(`id=${String(p.id)}`);
  if ("over" in p) parts.push(`over=${p.over ? String(p.over.id) : "none"}`);
  if (typeof p["reason"] === "string") parts.push(`reason=${p["reason"]}`);
  if (event === "error") parts.push(`phase=${String(p["phase"])} error=${String(p["error"])}`);
  return parts.join(" ");
}

/**
 * Opt-in operation logging. Records lifecycle events with timestamps for debugging and
 * diagnostics. It performs no I/O unless you provide `log`.
 */
export function loggerPlugin(options: LoggerPluginOptions = {}): LoggerPlugin {
  const entries: LogEntry[] = [];
  const limit = options.limit ?? 200;
  const events = options.events ?? DEFAULT_EVENTS;
  return {
    name: "logger",
    getEntries: () => entries,
    clear: () => {
      entries.length = 0;
    },
    setup(engine: DragEngine) {
      const offs = events.map((event) =>
        engine.on(event, (payload) => {
          const entry: LogEntry = { time: Date.now(), event, detail: describe(event, payload) };
          entries.push(entry);
          if (entries.length > limit) entries.shift();
          options.log?.(entry);
        }),
      );
      return () => offs.forEach((off) => off());
    },
  };
}
