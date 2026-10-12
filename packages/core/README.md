# @gripflow/core

The framework-independent engine behind Gripflow drag and drop: pointer, touch and keyboard sensors,
collision detection, modifiers, a sortable model, auto-scroll, live-region announcements, undo history
and an optimistic-update controller. No React, no DOM framework, no network access.

```bash
npm install @gripflow/core
```

Most apps should use the React packages instead:

- [`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react) hooks and provider
- [`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) sortable list, grid, table
- [`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) Kanban boards
- [`@gripflow/tree`](https://www.npmjs.com/package/@gripflow/tree) nested trees

Use `@gripflow/core` directly only to build an adapter for another UI framework. Exports include
`pointerSensor`, `keyboardSensor`, `SortableCoordinator`, `AutoScroller`, `GeometryCache`,
`createStore`, `createHistory` and `createOptimisticController`; see the bundled `.d.ts` files for
the full typed surface.

MIT licensed.
