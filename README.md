<div align="center">

# Gripflow

**Accessible, headless drag and drop for React and Next.js.**
Sortable lists, grids, tables, Kanban boards and nested trees, with mouse, touch and keyboard support.

[![npm](https://img.shields.io/npm/v/@gripflow/presets?label=%40gripflow%2Fpresets&color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/presets)
[![license](https://img.shields.io/github/license/salmannizam/Gripflow)](LICENSE)
[![types](https://img.shields.io/npm/types/@gripflow/react)](https://www.npmjs.com/package/@gripflow/react)

</div>

Gripflow is a small family of npm packages for **drag-and-drop in React and Next.js**. Pick the one that
matches what you are building, paste the example, and you have a working, accessible UI.

- **Headless and style-agnostic.** Use Tailwind, Bootstrap, CSS Modules or plain CSS. Nothing is forced on you.
- **Accessible.** Full keyboard dragging and screen-reader announcements.
- **Mouse, touch and keyboard** from one API.
- **Rules built in.** Locked items, WIP limits, workflow transitions, depth limits.
- **Optimistic updates with rollback**, plus a server-side validator.
- **TypeScript first**, React 18 and 19, Next.js App Router ready, tree-shakeable.
- **Your data stays yours.** Gripflow never mutates your arrays; it tells you what changed.

## Which package do I need?

| I want to... | Install | Docs |
| --- | --- | --- |
| Reorder a **list, grid or table** (fastest start) | `@gripflow/presets` | [README](packages/presets) |
| Build a **Kanban board** (Trello / Jira style) | `@gripflow/kanban` | [README](packages/kanban) |
| Build a **tree** (file explorer, nested menu, outline) | `@gripflow/tree` | [README](packages/tree) |
| Build something **fully custom** with hooks | `@gripflow/react` | [README](packages/react) |
| **Save moves safely on my server** (NestJS, Express, Next.js routes) | `@gripflow/nestjs-adapter` | [README](packages/nestjs-adapter) |
| Use the **engine without React** or write plugins | `@gripflow/core` | [README](packages/core) |

Everything React-based needs `@gripflow/react`, `react` and `react-dom` (18 or 19).

## 60-second example: sortable list

```bash
npm install @gripflow/presets @gripflow/react
```

```tsx
"use client"; // Next.js App Router

import { useState } from "react";
import { SortableList } from "@gripflow/presets";

export function Tasks() {
  const [tasks, setTasks] = useState([
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

Drag with the mouse or your finger, or use the keyboard: `Tab` to an item, `Space` to pick it up, arrow
keys to move, `Space` to drop, `Esc` to cancel.

## Kanban board in one component

```bash
npm install @gripflow/kanban @gripflow/react
```

```tsx
"use client";
import { useState } from "react";
import { KanbanBoard } from "@gripflow/kanban/react";

export function Board({ initial }) {
  const [columns, setColumns] = useState(initial); // [{ id, title, cards: [{ id, title }] }]
  return (
    <KanbanBoard
      columns={columns}
      onChange={(next) => setColumns([...next])}
      rules={{ transitions: { todo: ["doing"], doing: ["todo", "done"] }, maxCards: (c) => (c.id === "doing" ? 3 : undefined) }}
      renderColumn={(state, cards) => <section ref={state.setNodeRef}><h3>{state.column.title}</h3>{cards}</section>}
      renderCard={(card, state) => <div ref={state.setNodeRef} style={state.style} {...state.attributes}>{card.title}</div>}
    />
  );
}
```

See the [Kanban README](packages/kanban) for the full, styled version with optimistic saving.

## Packages

| Package | Description |
| --- | --- |
| [`@gripflow/presets`](packages/presets) | `SortableList`, `SortableGrid`, `SortableTable`, plus an optional stylesheet |
| [`@gripflow/kanban`](packages/kanban) | Board drag and drop, rules, optimistic updates, pure board functions |
| [`@gripflow/tree`](packages/tree) | Nested tree drag and drop, depth and move rules, pure tree functions |
| [`@gripflow/react`](packages/react) | `DragDropProvider`, `useSortable`, `useDraggable`, `useDroppable`, `DragOverlay` |
| [`@gripflow/nestjs-adapter`](packages/nestjs-adapter) | Server-side validation, rules, permissions and conflict handling |
| [`@gripflow/core`](packages/core) | Sensors, collision detection, modifiers, auto-scroll, announcements |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Tab` | Focus an item |
| `Space` | Pick up / drop |
| `Arrow keys` | Move while picked up |
| `Esc` | Cancel |
| `Alt + Arrow keys` | Kanban: move cards and columns directly. Tree: move and indent nodes directly |

## FAQ

**Does it work with Next.js?** Yes. Components that use drag and drop must be Client Components: put
`"use client"` at the top of the file. The packages are marked for the App Router already.

**Do I have to use Tailwind or Bootstrap?** No, and nothing in Gripflow depends on them. Every example
works with plain CSS, and each README shows Tailwind and Bootstrap variants.

**Does it work on phones and tablets?** Yes, through pointer events. Drag from a handle to keep page
scrolling natural.

**Do I need NestJS?** No. `@gripflow/nestjs-adapter` works with Express, Fastify, serverless functions
and Next.js route handlers, and has no NestJS dependency.

**Why do items snap back after I drop them?** Gripflow never changes your data for you. Update your state
in the change handler (`onItemsChange`, `onChange` or `onDragEnd`).

## Develop locally

```bash
git clone https://github.com/salmannizam/Gripflow.git
cd Gripflow
npm install
npm run typecheck && npm test && npm run build
```

See [TESTING.md](TESTING.md) for packing and trying the tarballs in your own app.

## Contributing

Bug reports and ideas are welcome: [open an issue](https://github.com/salmannizam/Gripflow/issues). If
Gripflow helps you, a star on GitHub helps other developers find it.

## Author

Created and maintained by [**salmannizam**](https://github.com/salmannizam). Released under the [MIT License](LICENSE).
