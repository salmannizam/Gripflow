<div align="center">

# @gripflow/presets

**Drag-and-drop sortable list, grid and table for React and Next.js.**
Ready to use in minutes. Bring your own styling: Tailwind, Bootstrap, CSS Modules or plain CSS.

[![npm](https://img.shields.io/npm/v/@gripflow/presets?color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/presets)
[![types](https://img.shields.io/npm/types/@gripflow/presets)](https://www.npmjs.com/package/@gripflow/presets)
[![license](https://img.shields.io/npm/l/@gripflow/presets)](https://github.com/salmannizam/Gripflow/blob/main/LICENSE)

</div>

This is the **fastest way to add drag-and-drop reordering** to a React app. You give it your array and a
render function; it handles dragging, the floating preview, keyboard support and screen-reader
announcements.

- `SortableList`: vertical list, horizontal list or wrapping grid
- `SortableGrid`: `SortableList` with `layout="grid"`
- `SortableTable`: a real `<table>` whose rows can be reordered
- Mouse, touch and keyboard (Space to pick up, arrows to move, Space to drop, Escape to cancel)
- Locked items, empty states, custom drag preview, drag handles
- No required CSS. An optional, tiny stylesheet is included

## Install

```bash
npm install @gripflow/presets @gripflow/react
```

Requires React 18 or 19. Works with the Next.js App Router (put `"use client"` at the top of the file).

## Quick start

```tsx
"use client";

import { useState } from "react";
import { SortableList } from "@gripflow/presets";

type Task = { id: string; title: string };

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: "1", title: "Write the docs" },
    { id: "2", title: "Ship version 1" },
    { id: "3", title: "Celebrate" },
  ]);

  return (
    <SortableList
      items={tasks}
      getId={(task) => task.id}
      onItemsChange={(next) => setTasks([...next])}
      aria-label="Tasks"
      renderItem={(task, state) => (
        <div style={{ padding: 12, opacity: state.isDragging ? 0.4 : 1 }}>{task.title}</div>
      )}
    />
  );
}
```

That's it. The list is now draggable with mouse, touch and keyboard.

- `getId` must return a **stable, unique id** (use your database id, not the array index).
- `onItemsChange` gives you the **new array**. Save it to state (and your API) there.
- Not using state? Pass `defaultItems` instead of `items` and the list manages itself.

## With a drag handle

```tsx
<SortableList
  items={tasks}
  getId={(t) => t.id}
  onItemsChange={(next) => setTasks([...next])}
  handle
  renderItem={(task, state) => (
    <div className="row">
      <button {...state.handleProps} aria-label={`Drag ${task.title}`}>⠿</button>
      <span>{task.title}</span>
    </div>
  )}
/>
```

With `handle`, only the element that receives `{...state.handleProps}` starts a drag, so text inside
the row stays selectable and inputs keep working.

## Tailwind CSS

```tsx
<SortableList
  items={tasks}
  getId={(t) => t.id}
  onItemsChange={(next) => setTasks([...next])}
  className="flex flex-col gap-2"
  renderItem={(task, state) => (
    <div
      className={`rounded-lg border bg-white p-3 shadow-sm ${
        state.isDragging ? "opacity-40" : ""
      } ${state.isOver ? "ring-2 ring-indigo-400" : ""}`}
    >
      {task.title}
    </div>
  )}
/>
```

## Bootstrap

```tsx
<SortableList
  items={tasks}
  getId={(t) => t.id}
  onItemsChange={(next) => setTasks([...next])}
  className="list-group"
  itemClassName="list-group-item"
  renderItem={(task) => task.title}
/>
```

## Plain CSS / CSS Modules

Items expose state as data attributes, so you can style them without any JavaScript:

```css
[data-gripflow-item][data-dragging] { opacity: 0.4; }
[data-gripflow-item][data-over]     { outline: 2px solid #6366f1; }
[data-gripflow-item][data-invalid]  { outline: 2px dashed #dc2626; }
[data-gripflow-item][data-disabled] { cursor: not-allowed; opacity: 0.6; }
```

Optionally import the built-in starter styles (small, CSS variables, zero specificity so your CSS wins):

```tsx
import "@gripflow/presets/styles.css";
```

## Grid and horizontal layouts

```tsx
<SortableList layout="grid" … />        // or <SortableGrid … />
<SortableList layout="horizontal" … />
```

## Locked items and empty state

```tsx
<SortableList
  items={tasks}
  getId={(t) => t.id}
  isItemDisabled={(task) => task.id === "1"}   // this one cannot be dragged
  emptyState={<p>No tasks yet. Drop items here.</p>}
  …
/>
```

## Custom drag preview

By default the floating preview is a copy of the row. Provide your own:

```tsx
<SortableList
  overlay={(task) => <div className="chip">{task.title}</div>}
  …
/>
```

Use `overlay={false}` to move the real element instead of showing a preview.

## Sortable table

```tsx
"use client";

import { useState } from "react";
import { SortableTable } from "@gripflow/presets";

type User = { id: string; name: string; role: string };

export function Users() {
  const [users, setUsers] = useState<User[]>([
    { id: "u1", name: "Ada", role: "Engineer" },
    { id: "u2", name: "Linus", role: "Maintainer" },
  ]);

  return (
    <SortableTable
      rows={users}
      getRowId={(user) => user.id}
      onRowsChange={(next) => setUsers([...next])}
      caption="Team"
      columns={[
        { key: "name", header: "Name", cell: (user) => user.name },
        { key: "role", header: "Role", cell: (user) => user.role },
      ]}
    />
  );
}
```

The table keeps real `<table>` semantics: a handle button in the first column reorders the row.

## Save the new order to your server

```tsx
onItemsChange={async (next, move) => {
  setTasks([...next]);               // optimistic update
  await fetch("/api/tasks/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: next.map((t) => t.id) }),
  });
}}
```

For validation, permission checks and rollback on failure, see
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter).

## Props reference (`SortableList`)

| Prop | Type | Description |
| --- | --- | --- |
| `items` / `defaultItems` | `T[]` | Controlled / uncontrolled items |
| `getId` | `(item) => string \| number` | **Required.** Stable id |
| `renderItem` | `(item, state) => ReactNode` | **Required.** Draw one item |
| `onItemsChange` | `(items, move) => void` | Called with the new array after a drop |
| `layout` | `"vertical" \| "horizontal" \| "grid"` | Default `"vertical"` |
| `handle` | `boolean` | Only `state.handleProps` starts drags |
| `isItemDisabled` | `(item) => boolean` | Lock items |
| `emptyState` | `ReactNode` | Shown when empty (still a drop target) |
| `overlay` | `boolean \| (item) => ReactNode` | Floating preview |
| `containerAs`, `itemAs` | element or component | Change the wrapper tags (e.g. `"ul"` and `"li"`) |
| `className`, `itemClassName` | `string` (item: or function) | Styling |
| `provider` | `PresetProviderProps` | Sensors, modifiers, collision detection, animation, `canDrop`… |
| `aria-label`, `aria-labelledby` | `string` | Accessible name of the list |

`state` (the second argument of `renderItem`): `index`, `isDragging`, `isOverlay`, `isOver`,
`isInvalidOver`, `rejectionReason`, `disabled`, `dropPosition`, `handleProps`.

`SortableTable` takes `rows`, `getRowId`, `columns`, `onRowsChange`, `caption`, `isRowDisabled`,
`renderHandle`, `renderOverlay`, `emptyState`, `rowClassName` and `provider`.

## Troubleshooting

- **Nothing happens in Next.js**: add `"use client"` at the top of the file.
- **Items snap back**: update your state in `onItemsChange`.
- **Wrong item moves or flickers**: `getId` must return a stable unique id, not the index.
- **Text can't be selected / inputs don't work inside rows**: use `handle`.
- **Want something fully custom?** Use the primitives in [`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react).

## Related packages

[`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) ·
[`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) ·
[`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react) ·
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter)

## Author

Created and maintained by [salmannizam](https://github.com/salmannizam). Issues and ideas are welcome on
[GitHub](https://github.com/salmannizam/Gripflow/issues). MIT licensed.
