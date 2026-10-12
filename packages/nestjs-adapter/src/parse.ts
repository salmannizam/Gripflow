import type { UniqueId } from "@gripflow/core";
import type { MoveRequest } from "./contracts";

export type ParseResult =
  | { readonly ok: true; readonly request: MoveRequest }
  | { readonly ok: false; readonly message: string };

const MAX_ID_LENGTH = 256;
const MAX_INDEX = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is UniqueId {
  if (typeof value === "string") return value.length > 0 && value.length <= MAX_ID_LENGTH;
  return typeof value === "number" && Number.isFinite(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_INDEX;
}

function isVersion(value: unknown): value is string | number {
  return (typeof value === "string" && value.length <= MAX_ID_LENGTH) || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Validates an untrusted JSON body and returns a typed request. Unknown fields are dropped (so
 * nothing unexpected reaches your storage layer) and ids/indexes are bounded. This is shape
 * validation only: whether the move is *allowed* is decided by the rules and your `authorize`.
 */
export function parseMoveRequest(input: unknown): ParseResult {
  if (!isRecord(input)) return { ok: false, message: "The request body must be a JSON object." };
  const bad = (field: string): ParseResult => ({ ok: false, message: `Invalid or missing "${field}".` });
  const version = input.expectedVersion;
  if (version !== undefined && !isVersion(version)) return bad("expectedVersion");
  const expectedVersion = version === undefined ? {} : { expectedVersion: version };

  switch (input.type) {
    case "reorder": {
      if (typeof input.listId !== "string" || input.listId.length === 0 || input.listId.length > MAX_ID_LENGTH) {
        return bad("listId");
      }
      if (!isId(input.itemId)) return bad("itemId");
      if (!isIndex(input.toIndex)) return bad("toIndex");
      return {
        ok: true,
        request: { type: "reorder", listId: input.listId, itemId: input.itemId, toIndex: input.toIndex, ...expectedVersion },
      };
    }
    case "card": {
      if (!isId(input.cardId)) return bad("cardId");
      if (!isId(input.fromColumnId)) return bad("fromColumnId");
      if (!isId(input.toColumnId)) return bad("toColumnId");
      if (!isIndex(input.toIndex)) return bad("toIndex");
      return {
        ok: true,
        request: {
          type: "card",
          cardId: input.cardId,
          fromColumnId: input.fromColumnId,
          toColumnId: input.toColumnId,
          toIndex: input.toIndex,
          ...expectedVersion,
        },
      };
    }
    case "column": {
      if (!isId(input.columnId)) return bad("columnId");
      if (!isIndex(input.toIndex)) return bad("toIndex");
      return { ok: true, request: { type: "column", columnId: input.columnId, toIndex: input.toIndex, ...expectedVersion } };
    }
    case "tree": {
      if (!isId(input.nodeId)) return bad("nodeId");
      if (input.toParentId !== null && !isId(input.toParentId)) return bad("toParentId");
      if (input.fromParentId !== undefined && input.fromParentId !== null && !isId(input.fromParentId)) {
        return bad("fromParentId");
      }
      if (!isIndex(input.toIndex)) return bad("toIndex");
      return {
        ok: true,
        request: {
          type: "tree",
          nodeId: input.nodeId,
          ...(input.fromParentId === undefined ? {} : { fromParentId: input.fromParentId }),
          toParentId: input.toParentId,
          toIndex: input.toIndex,
          ...expectedVersion,
        },
      };
    }
    default:
      return { ok: false, message: 'Unknown move type. Expected "reorder", "card", "column" or "tree".' };
  }
}
