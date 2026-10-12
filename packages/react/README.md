# @gripflow/react

Headless **React drag and drop** primitives for lists, grids, tables, Kanban boards and trees. Works
with Next.js (App Router), Tailwind, Bootstrap, CSS Modules or plain CSS. Mouse, touch and keyboard
support, screen-reader announcements, no styling imposed.

```bash
npm install @gripflow/react
```

Requires React 18 or 19.

> Most apps should start with a ready-made component instead of these primitives:
> [`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) (list, grid, table),
> [`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) (boards) or
> [`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) (nested trees). They are built
> entirely on the exports below.

## What is exported

| Export | Purpose |
| --- | --- |
| `DragDropProvider` | Creates the drag engine; accepts sensors, modifiers, collision strategy and event handlers |
| `useDraggable`, `useDroppable` | Low-level building blocks |
| `SortableContext`, `useSortable`, `useSortableContainer` | Sortable lists and grids, including across containers |
| `DragOverlay` | Moving preview rendered in a portal, with a drop animation |
| `useDragState`, `useDragMotion`, `useControllableState` | Read drag state and pointer motion |

## Next.js

Components that use these hooks must be Client Components. The published React bundles start with
`"use client"`, so they can be imported from a Server Component file and rendered from there.

## Accessibility

Items are focusable. Space picks up, arrow keys move, Space drops, Escape cancels, and moves are
announced through a live region. Please test with your own screen readers before making conformance
claims.

MIT licensed.
