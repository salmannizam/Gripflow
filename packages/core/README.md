<div align="center">

# @gripflow/core

**The framework-independent drag-and-drop engine behind Gripflow.**
Pointer, touch and keyboard sensors, collision detection, modifiers, sortable math, auto-scroll and accessibility announcements, in plain TypeScript.

[![npm](https://img.shields.io/npm/v/@gripflow/core?color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/core)
[![types](https://img.shields.io/npm/types/@gripflow/core)](https://www.npmjs.com/package/@gripflow/core)
[![license](https://img.shields.io/npm/l/@gripflow/core)](https://github.com/salmannizam/Gripflow/blob/main/LICENSE)

</div>

> **Building a React or Next.js app?** You don't need to install this directly. Start with
> [`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) (sortable list, grid, table),
> [`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) or
> [`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree). `@gripflow/core` is installed for you.

Install `@gripflow/core` when you want to:

- use the **pure helpers** (`arrayMove`, `applySortableMove`, collision functions) on the server or in tests,
- write **custom sensors, modifiers or collision detection**,
- or build an **adapter for another UI framework** (Vue, Svelte, Solid, vanilla DOM).

It has no React dependency, no network access and no telemetry.

## Install

```bash
npm install @gripflow/core
```

## Pure helpers

Reordering without mutating your data:

```ts
import { arrayMove, applySortableMove } from "@gripflow/core";

arrayMove(["a", "b", "c"], 0, 2); // ["b", "c", "a"]

// Apply the move reported by a drag-end event, by id, across containers:
const next = applySortableMove({ todo: todoCards, done: doneCards }, event.move, (card) => card.id);
```

Also exported: `arrayInsert`, `arrayRemove`, `moveById`, `moveBetweenContainers`, `findContainerOf`.

## The engine

`DragEngine` is the headless state machine. It owns sensors, the active drag, drop validation and events;
you register elements and render the result however your framework does.

```ts
import { DragEngine, pointerSensor, keyboardSensor } from "@gripflow/core";

const engine = new DragEngine({
  sensors: [pointerSensor(), keyboardSensor()],
  onDragEnd(event) {
    console.log("dropped", event.active.id, "over", event.over?.id, "move:", event.move);
  },
});

const unmount = engine.mount(); // starts listening; call the returned function to stop

const card = document.querySelector<HTMLElement>("#card-1")!;
const registration = engine.registerDraggable({ id: "card-1", element: card });

// later:
registration.unregister();
unmount();
```

The React packages (`@gripflow/react` and friends) are thin bindings around exactly this API.

## Building blocks

| Area | Exports |
| --- | --- |
| Engine | `DragEngine`, `createStore`, `SortableCoordinator`, `GeometryCache` |
| Sensors | `pointerSensor`, `keyboardSensor`, `isInteractiveTarget` |
| Collision detection | `closestCenter`, `closestCorners`, `pointerWithin`, `rectIntersection`, `containerAware`, `composeDetectors`, `defaultCollisionDetector` |
| Modifiers | `restrictToVerticalAxis`, `restrictToHorizontalAxis`, `restrictToWindowEdges`, `restrictToParentElement`, `restrictToBounds`, `snapToGrid` |
| Sorting strategies | `verticalListStrategy`, `horizontalListStrategy`, `rectSortingStrategy`, `noSortingStrategy` |
| Sortable data | `arrayMove`, `applySortableMove`, `moveBetweenContainers`, `arrayInsert`, `arrayRemove` |
| Scrolling and motion | `AutoScroller`, `resolveAnimation`, `prefersReducedMotion` |
| Accessibility | `createDefaultAnnouncements`, `DEFAULT_INSTRUCTIONS` |
| Helpers | `createHistory` (undo/redo), `createOptimisticController` (optimistic updates with rollback), `loggerPlugin` |

Example: constrain dragging to a vertical axis (works through `@gripflow/react`'s `modifiers` prop too):

```ts
import { restrictToVerticalAxis, restrictToWindowEdges } from "@gripflow/core";

new DragEngine({ modifiers: [restrictToVerticalAxis, restrictToWindowEdges()] });
```

Every export is fully typed, so your editor shows documentation as you type.

## Events

`dragStart`, `dragMove`, `dragOver`, `dropTargetEnter`, `dropTargetLeave`, `dropRequested`,
`dropAccepted`, `dropRejected`, `dragEnd`, `dragCancel`, `error`. Subscribe with `engine.on(name, handler)` or
pass `onDragEnd`-style handlers in the options.

## Related packages

[`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react) ·
[`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) ·
[`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) ·
[`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) ·
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter)

## Author

Created and maintained by [salmannizam](https://github.com/salmannizam). Issues and ideas are welcome on
[GitHub](https://github.com/salmannizam/Gripflow/issues). MIT licensed.
