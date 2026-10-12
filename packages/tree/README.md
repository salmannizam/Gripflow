# @gripflow/tree

**Nested tree drag and drop for React**: sortable file trees, folder hierarchies, outlines and
menu builders. Drop before, after or inside a node, with rules for maximum depth, locked nodes and
which nodes accept children. Keyboard support (Alt+Arrow keys to move and indent). Headless.

```bash
npm install @gripflow/tree @gripflow/react
```

The root export is pure TypeScript (`moveNode`, `canMoveNode`, `flattenTree`, `filterTree`, ...) and
works without React. The React part lives in `@gripflow/tree/react`.

## Usage

```tsx
"use client";
import { useState } from "react";
import type { FlatTreeNode } from "@gripflow/tree";
import { TreeDnd, useTree, useTreeItem } from "@gripflow/tree/react";

type FileNode = { id: string; name: string; kind: "file" | "folder"; children?: FileNode[] };

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

function Row({ row }: { row: FlatTreeNode<FileNode> }) {
  const item = useTreeItem(row);
  return (
    <div
      ref={item.setNodeRef}
      {...item.attributes}
      style={{ ...item.style, paddingLeft: row.depth * 20 }}
      data-drop={item.dropPosition ?? undefined}
    >
      {row.node.name}
    </div>
  );
}

export function FileTree({ initial }: { initial: FileNode[] }) {
  const [nodes, setNodes] = useState(initial);
  return (
    <TreeDnd
      nodes={nodes}
      onChange={(next) => setNodes([...next])}
      rules={{ maxDepth: 3, acceptsChildren: (n) => n.kind === "folder" }}
      onMoveRejected={(failure) => console.warn(failure.message)}
    >
      <Rows />
    </TreeDnd>
  );
}
```

`useTreeItem` also exposes `isValidDrop` and `rejectionReason` so you can show why a drop is refused.
Rows that do not accept children only offer before/after drop zones.

MIT licensed.
