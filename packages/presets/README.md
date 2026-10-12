# @gripflow/presets

Ready-made **React sortable list, grid and table** with drag and drop. Bring your own markup and
styling (Tailwind, Bootstrap, CSS Modules, plain CSS). An optional, zero-specificity stylesheet is
included.

```bash
npm install @gripflow/presets @gripflow/react
```

## Sortable list

```tsx
"use client";
import { useState } from "react";
import { SortableList } from "@gripflow/presets";
import "@gripflow/presets/styles.css"; // optional

type Task = { id: string; title: string };

export function Tasks() {
  const [items, setItems] = useState<Task[]>([
    { id: "1", title: "Write docs" },
    { id: "2", title: "Ship it" },
  ]);

  return (
    <SortableList
      items={items}
      getId={(task) => task.id}
      onItemsChange={(next) => setItems([...next])}
      handle
      aria-label="Tasks"
      renderItem={(task, state) => (
        <div className="row">
          <button {...state.handleProps} aria-label={`Drag ${task.title}`}>⠿</button>
          {task.title}
        </div>
      )}
    />
  );
}
```

Useful props: `layout` (`"vertical" | "horizontal" | "grid"`), `handle`, `isItemDisabled`,
`emptyState`, `overlay`, `containerAs` / `itemAs`, and `provider` for sensors, modifiers and
collision strategy. `SortableGrid` and `SortableTable` are also exported.

Items expose `data-dragging`, `data-over`, `data-invalid`, `data-disabled` and `data-drop-position`
attributes for styling.

MIT licensed.
