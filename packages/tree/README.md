<div align="center">

# @gripflow/tree

**Drag-and-drop tree view for React and Next.js.**
File trees, folder hierarchies, outlines and menu builders with move rules and keyboard support.

[![npm](https://img.shields.io/npm/v/@gripflow/tree?color=cb3837&logo=npm)](https://www.npmjs.com/package/@gripflow/tree)
[![types](https://img.shields.io/npm/types/@gripflow/tree)](https://www.npmjs.com/package/@gripflow/tree)
[![license](https://img.shields.io/npm/l/@gripflow/tree)](https://github.com/salmannizam/Gripflow/blob/main/LICENSE)

</div>

Drop a node **before, after or inside** another node. You describe the tree as nested data and draw
each row yourself. Gripflow handles dragging, drop zones, rules, expand/collapse and keyboard moves.

- Nested data in, nested data out. Your tree is never mutated
- **Rules**: maximum depth, locked nodes, which nodes can hold children, custom checks
- Cannot drop a folder into itself or its own descendants
- ARIA tree semantics, roving focus, arrow-key navigation, `Alt + Arrow keys` to move and indent
- A pure, framework-free part (`moveNode`, `flattenTree`, `filterTree`...) for servers and tests

## Install

```bash
npm install @gripflow/tree @gripflow/react
```

Requires React 18 or 19. React parts come from `@gripflow/tree/react`; pure helpers from `@gripflow/tree`.

## Quick start: a file tree

```tsx
"use client";

import { useState } from "react";
import type { FlatTreeNode } from "@gripflow/tree";
import { TreeDnd, useTree, useTreeItem } from "@gripflow/tree/react";

type FileNode = {
  id: string;
  name: string;
  kind: "file" | "folder";
  children?: FileNode[];
};

const initial: FileNode[] = [
  {
    id: "src",
    name: "src",
    kind: "folder",
    children: [
      { id: "app", name: "App.tsx", kind: "file" },
      { id: "button", name: "Button.tsx", kind: "file" },
    ],
  },
  { id: "docs", name: "docs", kind: "folder", children: [] },
  { id: "readme", name: "README.md", kind: "file" },
];

function Row({ row }: { row: FlatTreeNode<FileNode> }) {
  const item = useTreeItem(row);
  return (
    <div
      ref={item.setNodeRef}
      {...item.attributes}
      style={{ ...item.style, paddingLeft: row.depth * 20 + 8 }}
      data-drop={item.dropPosition ?? undefined}
    >
      {row.hasChildren ? (
        <button type="button" onClick={item.toggle} aria-label={item.expanded ? "Collapse" : "Expand"}>
          {item.expanded ? "▾" : "▸"}
        </button>
      ) : null}
      {row.node.kind === "folder" ? "📁" : "📄"} {row.node.name}
    </div>
  );
}

function Rows() {
  const tree = useTree<FileNode>();
  return (
    <div {...tree.treeProps} aria-label="Project files">
      {tree.rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </div>
  );
}

export function FileTree() {
  const [nodes, setNodes] = useState(initial);
  return (
    <TreeDnd
      nodes={nodes}
      onChange={(next) => setNodes([...next])}
      rules={{ acceptsChildren: (node) => node.kind === "folder" }}
    >
      <Rows />
    </TreeDnd>
  );
}
```

How it works:

- `nodes` is nested data: each node has an `id` and optional `children`. Add any fields you want.
- `<TreeDnd>` owns drag and expansion state. Render rows **inside** it.
- `useTree()` gives you the visible, flattened `rows` (collapsed branches are hidden).
- `useTreeItem(row)` gives you everything one row needs: ref, ARIA attributes, drop position, toggle.
- `onChange` gives you the **new tree**. Store it in state (and save it to your API).

Style the drop feedback with the `data-drop` attribute (`before`, `after` or `inside`):

```css
[data-drop="before"] { box-shadow: inset 0 2px 0 #6366f1; }
[data-drop="after"]  { box-shadow: inset 0 -2px 0 #6366f1; }
[data-drop="inside"] { background: #eef2ff; }
```

Rows that do not accept children (files) only offer "before" and "after".

## Rules

```tsx
<TreeDnd
  nodes={nodes}
  onChange={(next) => setNodes([...next])}
  rules={{
    maxDepth: 3,                                   // root is level 0
    isLocked: (node) => node.id === "readme",      // cannot be dragged
    acceptsChildren: (node) => node.kind === "folder",
    canMove: ({ node, parent }) =>
      node.kind === "folder" && parent?.id === "docs" ? { ok: false, reason: "No folders in docs." } : true,
  }}
  onMoveRejected={(failure) => toast(failure.message)}
>
```

`maxDepth` includes the moved subtree's height, so a folder with grandchildren needs spare levels.
`onMoveRejected` receives a readable `message` and a `reason` (`max-depth`, `locked`, `into-descendant`,
`parent-rejected`, `rejected`, ...).

While hovering, `item.isValidDrop` and `item.rejectionReason` tell you whether the drop would be refused,
so you can show why. Do not rely on color alone.

## Expand and collapse

```tsx
<TreeDnd defaultExpandedIds="all" …>   {/* default */}
<TreeDnd defaultExpandedIds={new Set(["src"])} …>
```

Controlled mode: pass `expandedIds` and `onExpandedChange`. From `useTree()`: `toggle`, `expand`,
`collapse`, `expandAll`, `collapseAll`.

Dropping into a collapsed folder expands it automatically.

## Search and filter

```tsx
import { filterTree } from "@gripflow/tree";

const { visibleIds } = filterTree(nodes, (node) => node.name.toLowerCase().includes(query));
<TreeDnd nodes={nodes} visibleIds={visibleIds} …>
```

## Keyboard and accessibility

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move focus between rows |
| `→` / `←` | Expand / collapse, or move to child / parent |
| `Home` / `End` | First / last row |
| `Space` | Pick up / drop |
| `Alt + ↑ / ↓` | Move the node up / down among its siblings |
| `Alt + → / ←` | Indent into the previous sibling / outdent to the parent's level |
| `Esc` | Cancel |

Rows use ARIA tree semantics (`role="tree"`, `treeitem`, `aria-level`, `aria-posinset`, `aria-setsize`,
`aria-expanded`). Moves are announced. Please still test with your own assistive technology.

## Pure functions (no React)

```ts
import { moveNode, flattenTree, canMoveNode } from "@gripflow/tree";

const result = moveNode(nodes, { id: "button", parentId: "docs", index: 0 }, rules);
if (result.ok) {
  save(result.tree);  // new tree, input is never mutated
} else {
  console.log(result.reason, result.message);
}
```

`index` is the position among the destination's children **after** the node has left its old place.
Also exported: `buildTree`, `flattenTree`, `filterTree`, `findNode`, `getAncestorIds`,
`getDescendantIds`, `insertNode`, `removeNode`, `updateNode`, `walkTree`, `indentNode`, `outdentNode`,
`moveUp`, `moveDown`.

## Props reference (`TreeDnd`)

| Prop | Description |
| --- | --- |
| `nodes` | **Required.** Nested nodes: `{ id, children? }` plus any fields |
| `onChange(nodes, move)` | New tree after an accepted drop or keyboard move |
| `rules` | `maxDepth`, `isLocked`, `acceptsChildren`, `canMove` |
| `expandedIds`, `defaultExpandedIds`, `onExpandedChange` | Expansion state |
| `visibleIds` | Only these ids are rendered (search) |
| `getLabel(node)` | Name used in announcements (default: `label`, `name` or `title`) |
| `onMoveRejected(failure, move)` | A move was refused by the rules |
| …provider props | `modifiers`, `autoScroll`, `animation`, … |

## Troubleshooting

- **Nothing happens in Next.js**: add `"use client"` at the top of the file.
- **Node snaps back**: update your state in `onChange`.
- **"must be used inside `<TreeDnd>`"**: render `useTree` / `useTreeItem` in components below `<TreeDnd>`.
- **Node ids must be unique across the whole tree.**
- **Drop indicator makes rows jump**: that's fine, row heights are frozen during a drag, but prefer `box-shadow` over borders that change layout.

## Related packages

[`@gripflow/presets`](https://www.npmjs.com/package/@gripflow/presets) ·
[`@gripflow/kanban`](https://www.npmjs.com/package/@gripflow/kanban) ·
[`@gripflow/react`](https://www.npmjs.com/package/@gripflow/react) ·
[`@gripflow/nestjs-adapter`](https://www.npmjs.com/package/@gripflow/nestjs-adapter)

## Author

Created and maintained by [salmannizam](https://github.com/salmannizam). Issues and ideas are welcome on
[GitHub](https://github.com/salmannizam/Gripflow/issues). MIT licensed.
