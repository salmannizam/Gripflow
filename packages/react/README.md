<div align="center">

# @gripflow/react

**Headless drag and drop primitives for React and Next.js.**
Sortable lists and grids, drag overlays, drop targets, mouse + touch + keyboard, screen-reader announcements.

[![npm](https://img.shields.io/npm/v/@gripflow/react?color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/react)
[![types](https://img.shields.io/npm/types/@gripflow/react)](https://www.npmjs.com/package/@gripflow/react)
[![license](https://img.shields.io/npm/l/@gripflow/react)](https://github.com/salmannizam/Gripflow/blob/main/LICENSE)

</div>

> **New here?** You probably want [`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets)
> (a ready-made sortable list, grid or table), [`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban)
> (boards) or [`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) (nested trees).
> All of them are built on this package. Use `@gripflow/react` directly when you want full control of
> your markup.

## Why use it

- **Headless.** No CSS, no markup. Works with Tailwind, Bootstrap, CSS Modules, styled-components or plain CSS.
- **Accessible by default.** Keyboard dragging (Space to pick up, arrows to move, Space to drop, Escape to cancel) and live-region announcements.
- **Pointer, touch and keyboard** in one API.
- **React 18 and 19**, Strict Mode safe, SSR safe, TypeScript types included.
- **You own the data.** Gripflow never mutates your arrays. It tells you what moved and you update state.

## Install

```bash
npm install @gripflow/react
```

Peer dependencies: `react` and `react-dom` (18 or 19). `@gripflow/core` is installed automatically.

## Quick start: a sortable list

```tsx
"use client"; // Next.js App Router: drag and drop runs in the browser

import { useState } from "react";
import { applySortableMove } from "@gripflow/core";
import { DragDropProvider, SortableContext, useSortable } from "@gripflow/react";

type Task = { id: string; title: string };

function TaskRow({ task }: { task: Task }) {
  const sortable = useSortable({ id: task.id });
  return (
    <li
      ref={sortable.setNodeRef}
      style={sortable.style}
      {...sortable.attributes}
      className={sortable.isDragging ? "row row--dragging" : "row"}
    >
      {task.title}
    </li>
  );
}

export function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: "1", title: "Write the docs" },
    { id: "2", title: "Ship version 1" },
    { id: "3", title: "Celebrate" },
  ]);

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (!event.move) return; // dropped outside, or nothing changed
        setTasks((current) => {
          const next = applySortableMove({ tasks: current }, event.move!, (task) => task.id);
          return [...(next.tasks ?? current)];
        });
      }}
    >
      <SortableContext id="tasks" items={tasks.map((task) => task.id)}>
        <ul>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      </SortableContext>
    </DragDropProvider>
  );
}
```

That's a complete sortable list. Try it with the mouse, with touch, and with the keyboard: Tab to a row,
press **Space**, use **Arrow keys**, press **Space** to drop (or **Escape** to cancel).

Rules of thumb:

- Give every item a **stable `id`** (a database id), never the array index.
- The `id` of `<SortableContext>` must match the key you use in `applySortableMove`.
- `useSortable` must be called inside `<SortableContext>`, which must be inside `<DragDropProvider>`.

## Add a drag handle

By default the whole row is the drag handle. To drag only by a grip button, attach
`setActivatorNodeRef` to it:

```tsx
function TaskRow({ task }: { task: Task }) {
  const s = useSortable({ id: task.id });
  return (
    <li ref={s.setNodeRef} style={s.style}>
      <button ref={s.setActivatorNodeRef} {...s.attributes} aria-label={`Drag ${task.title}`}>
        ⠿
      </button>
      {task.title}
    </li>
  );
}
```

(When using a handle, spread `s.attributes` on the handle, not on the row.)

## Show a floating preview (DragOverlay)

```tsx
import { DragDropProvider, DragOverlay } from "@gripflow/react";

<DragDropProvider onDragEnd={handleDragEnd}>
  {/* ...your SortableContext and rows... */}
  <DragOverlay>{(active) => <div className="card">{String(active.data?.label ?? active.id)}</div>}</DragOverlay>
</DragDropProvider>;
```

Pass `data={{ label: "My task" }}` to `useSortable({ id, data })` so the overlay and the screen-reader
announcements can name the item. The overlay is rendered in a portal, follows the pointer without
re-rendering React, and animates into place on drop.

## Grids and horizontal lists

```tsx
<SortableContext id="photos" items={ids} axis="grid">…</SortableContext> // wrapping grid
<SortableContext id="tabs" items={ids} axis="x">…</SortableContext>      // horizontal row
```

## Multiple lists (move between containers)

Render several `<SortableContext>` blocks inside one `<DragDropProvider>`, each with its own `id` and
`items`. Call `useSortableContainer()` on the element wrapping each list so **empty lists accept drops**:

```tsx
function Column({ id, items, children }: { id: string; items: string[]; children: React.ReactNode }) {
  return (
    <SortableContext id={id} items={items}>
      <ColumnBody>{children}</ColumnBody>
    </SortableContext>
  );
}

function ColumnBody({ children }: { children: React.ReactNode }) {
  const container = useSortableContainer();
  return <div ref={container.setNodeRef}>{children}</div>;
}
```

In `onDragEnd`, `event.move` contains the source and destination container ids and indexes, and
`applySortableMove` handles moves across containers. For Kanban boards use
[`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban), which does all this for you.

## Rejecting drops

```tsx
<DragDropProvider
  canDrop={({ active, over }) => (over?.id === "locked" ? { ok: false, reason: "That list is locked." } : true)}
  onDropRejected={(event) => alert(event.reason)}
/>
```

Items can also be disabled: `useSortable({ id, disabled: true })`.

## Styling hooks

| From `useSortable` | Meaning |
| --- | --- |
| `isDragging` | This item is being dragged (or settling after a drop) |
| `isOver` / `isInvalidOver` | The dragged item is over this one / over it but the drop would be rejected |
| `dropPosition` | `"before"` or `"after"` while this item is the drop target |
| `style` | Transform and transition that make room for the dragged item |

Do not rely on color alone to show an invalid drop; also show text or an icon.

## API reference

### `<DragDropProvider>`

| Prop | Description |
| --- | --- |
| `onDragStart`, `onDragMove`, `onDragOver`, `onDragEnd`, `onDragCancel` | Event handlers. `onDragEnd` receives `event.move` for sortable drops |
| `sensors` | Input sensors. Default: pointer (mouse, pen, touch) and keyboard |
| `collisionDetection` | How the drop target is chosen. Default works for lists, grids and nested containers |
| `modifiers` | Constrain movement, e.g. `restrictToVerticalAxis` from `@gripflow/core` |
| `autoScroll` | `false` to disable edge auto-scroll, or options |
| `animation` | `{ duration, easing }` for drop animations. Respects reduced-motion |
| `accessibility` | Customize announcements and instructions text |
| `canDrop`, `validateDrop`, `canActivate` | Veto drags and drops with an optional reason |
| `plugins` | Engine plugins (memoize the array) |

### Hooks and components

| Export | Purpose |
| --- | --- |
| `SortableContext` | Declares a container: `id`, `items` (ordered ids), `axis` (`"y"` default, `"x"`, `"grid"`) |
| `useSortable({ id, data?, disabled? })` | One sortable item |
| `useSortableContainer()` | Makes the container element a drop target (empty lists) |
| `useDraggable({ id, data?, disabled? })` | Low-level draggable |
| `useDroppable({ id, data?, disabled?, accepts? })` | Low-level drop target |
| `DragOverlay` | Floating preview rendered in a portal |
| `useDragState`, `useDragMotion` | Read the current drag state / pointer motion |
| `useControllableState` | Controlled / uncontrolled state helper |

Every type is exported with the package, so your editor shows documentation as you type.

## Troubleshooting

- **"must be used inside `<SortableContext>`"**: `useSortable` has to render below `SortableContext`, which has to render below `DragDropProvider`.
- **Nothing happens in Next.js**: the component needs `"use client"` at the top of the file.
- **Items snap back after dropping**: you must update your state in `onDragEnd`. Gripflow never reorders your data for you.
- **Wrong item moves**: ids must be stable and unique; do not use the array index.
- **Scrolling on touch screens fights the drag**: drag from a handle, or set `touch-action: none` on the handle.

## Related packages

[`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) ·
[`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) ·
[`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) ·
[`@gripflow/core`](https://www.npmjs.com/package/@gripflow/core) ·
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter)

## Author

Created and maintained by [salmannizam](https://github.com/salmannizam). Issues and ideas are welcome on
[GitHub](https://github.com/salmannizam/Gripflow/issues). MIT licensed.
