# Gripflow

Accessible, headless **drag and drop for React and Next.js**: sortable lists, grids, tables, Kanban
boards and nested trees. Mouse, touch and keyboard support, screen-reader announcements, optimistic
updates with server rollback, and no CSS framework lock-in (Tailwind, Bootstrap, CSS Modules or
plain CSS).

| Package | Use it for |
| --- | --- |
| [`@gripflow/presets`](packages/presets) | Sortable list, grid and table, the quickest start |
| [`@gripflow/kanban`](packages/kanban) | Kanban boards with rules, WIP limits and optimistic saves |
| [`@gripflow/tree`](packages/tree) | Nested trees with depth and move rules |
| [`@gripflow/react`](packages/react) | Headless React primitives the packages above are built on |
| [`@gripflow/core`](packages/core) | Framework-independent engine |
| [`@gripflow/nestjs-adapter`](packages/nestjs-adapter) | Server-side validation and persistence of moves (NestJS, Express, Node) |

```bash
npm install @gripflow/presets @gripflow/react
```

See [TESTING.md](TESTING.md) for how to build, test and try the packages locally.

MIT licensed.
