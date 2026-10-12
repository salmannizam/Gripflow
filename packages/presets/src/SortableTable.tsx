import type { CSSProperties, ReactNode, Ref } from "react";
import type { DragData, SortableMove, UniqueId } from "@gripflow/core";
import {
  DragDropProvider,
  DragOverlay,
  SortableContext,
  useSortable,
  useSortableContainer,
} from "@gripflow/react";
import { useSortableModel, type PresetProviderProps } from "./model";
import type { SortableHandleProps, SortableItemState } from "./SortableList";

export interface SortableTableColumn<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  /** Cell content. The row's {@link SortableItemState} is provided for drag-aware cells. */
  cell: (row: T, state: SortableItemState) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** Applied to both header and cells, e.g. `{ width: 120 }`. */
  style?: CSSProperties;
}

export interface SortableTableProps<T> {
  rows?: readonly T[];
  defaultRows?: readonly T[];
  onRowsChange?: (rows: readonly T[], move: SortableMove) => void;
  /** Stable row identity. Never use the row index. */
  getRowId: (row: T) => UniqueId;
  columns: readonly SortableTableColumn<T>[];
  id?: UniqueId;
  /** Accessible name of the table. */
  caption?: ReactNode;
  "aria-label"?: string;
  isRowDisabled?: (row: T) => boolean;
  getRowData?: (row: T) => DragData;
  /** Content for the (otherwise empty) handle column header. Default: visually hidden label. */
  handleHeader?: ReactNode;
  /** Renders the handle button; default is an unstyled `<button>` with a grip glyph. */
  renderHandle?: (props: SortableHandleProps, state: SortableItemState) => ReactNode;
  /** Shown in a full-width row when there are no rows. */
  emptyState?: ReactNode;
  /** Optional floating preview of the dragged row. Default: the row itself moves. */
  renderOverlay?: (row: T) => ReactNode;
  provider?: PresetProviderProps;
  className?: string;
  rowClassName?: string | ((row: T, state: SortableItemState) => string | undefined);
  style?: CSSProperties;
}

function defaultHandle(props: SortableHandleProps): ReactNode {
  const { ref, ...rest } = props;
  return (
    <button {...rest} ref={ref as Ref<HTMLButtonElement>} type="button" aria-label="Reorder row">
      <span aria-hidden="true">⠿</span>
    </button>
  );
}

interface RowProps<T> {
  row: T;
  id: UniqueId;
  disabled: boolean;
  data: DragData | undefined;
  columns: readonly SortableTableColumn<T>[];
  className: SortableTableProps<T>["rowClassName"];
  renderHandle: NonNullable<SortableTableProps<T>["renderHandle"]>;
}

function SortableTableRow<T>({
  row,
  id,
  disabled,
  data,
  columns,
  className,
  renderHandle,
}: RowProps<T>): ReactNode {
  const s = useSortable({ id, data, disabled });
  const handleProps: SortableHandleProps = {
    ...s.attributes,
    ref: s.setActivatorNodeRef,
    "data-gripflow-handle": "",
  };
  const state: SortableItemState = {
    index: s.index,
    isDragging: s.isDragging,
    isOverlay: false,
    isOver: s.isOver,
    isInvalidOver: s.isInvalidOver,
    rejectionReason: s.rejectionReason,
    disabled,
    dropPosition: s.dropPosition,
    handleProps,
  };
  return (
    <tr
      ref={s.setNodeRef as Ref<HTMLTableRowElement>}
      style={s.style}
      className={typeof className === "function" ? className(row, state) : className}
      data-gripflow-item=""
      data-dragging={s.isDragging || undefined}
      data-over={s.isOver || undefined}
      data-invalid={s.isInvalidOver || undefined}
      data-disabled={disabled || undefined}
      data-drop-position={s.dropPosition ?? undefined}
    >
      <td data-gripflow-handle-cell="">{renderHandle(handleProps, state)}</td>
      {columns.map((column) => (
        <td key={column.key} className={column.className} style={column.style}>
          {column.cell(row, state)}
        </td>
      ))}
    </tr>
  );
}

interface BodyProps<T> extends SortableTableProps<T> {
  list: readonly T[];
  containerId: UniqueId;
}

function SortableTableBody<T>(props: BodyProps<T>): ReactNode {
  const { list, containerId, columns, getRowId, isRowDisabled, getRowData, emptyState } = props;
  const container = useSortableContainer();
  return (
    <tbody
      ref={container.setNodeRef as Ref<HTMLTableSectionElement>}
      data-gripflow-list=""
      data-container-id={String(containerId)}
      data-drop-target={container.isDropTarget || undefined}
      data-invalid={container.isInvalidOver || undefined}
      data-empty={list.length === 0 || undefined}
    >
      {list.map((row) => {
        const id = getRowId(row);
        return (
          <SortableTableRow
            key={id}
            row={row}
            id={id}
            disabled={isRowDisabled?.(row) ?? false}
            data={getRowData?.(row)}
            columns={columns}
            className={props.rowClassName}
            renderHandle={props.renderHandle ?? defaultHandle}
          />
        );
      })}
      {list.length === 0 ? (
        <tr data-gripflow-empty="">
          <td colSpan={columns.length + 1}>{emptyState}</td>
        </tr>
      ) : null}
    </tbody>
  );
}

/**
 * A sortable `<table>`. Rows are reordered through a handle button in the first column, which
 * keeps native table semantics intact (rows are not turned into buttons). Style it with your
 * own classes; rows expose `data-dragging`, `data-over`, `data-invalid` and `data-disabled`.
 */
export function SortableTable<T>(props: SortableTableProps<T>): ReactNode {
  const { id, columns, caption, renderOverlay, getRowId } = props;
  const containerId = id ?? "gripflow-table";
  const model = useSortableModel<T>({
    items: props.rows,
    defaultItems: props.defaultRows,
    onItemsChange: props.onRowsChange,
    getId: getRowId,
    containerId,
    provider: props.provider,
  });
  return (
    <DragDropProvider {...model.providerProps}>
      <SortableContext id={containerId} items={model.ids} axis="y">
        <table
          className={props.className}
          style={props.style}
          aria-label={props["aria-label"]}
          data-gripflow-table=""
        >
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              <th scope="col" data-gripflow-handle-cell="">
                {props.handleHeader ?? <span data-gripflow-visually-hidden="">Reorder</span>}
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={column.headerClassName} style={column.style}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <SortableTableBody {...props} list={model.items} containerId={containerId} />
        </table>
      </SortableContext>
      {renderOverlay ? (
        <DragOverlay>
          {(active) => {
            const row = model.byId.get(active.id);
            return row === undefined ? null : renderOverlay(row);
          }}
        </DragOverlay>
      ) : null}
    </DragDropProvider>
  );
}
