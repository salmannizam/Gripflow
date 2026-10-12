import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type Ref,
} from "react";
import type { DragData, SortableMove, UniqueId } from "@gripflow/core";
import {
  DragDropProvider,
  DragOverlay,
  SortableContext,
  useSortable,
  useSortableContainer,
  type DraggableAttributes,
  type DragOverlayProps,
} from "@gripflow/react";
import { useSortableModel, type PresetProviderProps } from "./model";

/** Spread onto the element that should start drags (a `<button>` is recommended). */
export type SortableHandleProps = DraggableAttributes & {
  ref: (node: HTMLElement | null) => void;
  "data-gripflow-handle": "";
};

/** Everything a render function needs to draw one sortable item. */
export interface SortableItemState {
  index: number;
  /** This item is being dragged (or is settling after a drop). */
  isDragging: boolean;
  /** Rendered inside the drag overlay rather than in the list. */
  isOverlay: boolean;
  isOver: boolean;
  /** The dragged item is over this one but the drop would be rejected. */
  isInvalidOver: boolean;
  rejectionReason: string | null;
  disabled: boolean;
  /** Where the dragged item will land relative to this one while it is the target. */
  dropPosition: "before" | "after" | null;
  /** Props for a drag handle. Without `handle` on the list the whole item is the handle. */
  handleProps: SortableHandleProps;
}

export type SortableLayout = "vertical" | "horizontal" | "grid";

export interface SortableListProps<T> {
  /** Controlled items. The array you pass is never mutated; apply changes in `onItemsChange`. */
  items?: readonly T[];
  /** Initial items for uncontrolled use. */
  defaultItems?: readonly T[];
  /** Called with a new array after an accepted drop, plus the move that produced it. */
  onItemsChange?: (items: readonly T[], move: SortableMove) => void;
  /** Stable identity of an item. Never use the array index. */
  getId: (item: T) => UniqueId;
  renderItem: (item: T, state: SortableItemState) => ReactNode;
  /** Container identity (useful for tests and analytics). Default: generated. */
  id?: UniqueId;
  layout?: SortableLayout;
  /** Items can only be dragged by the element that receives `state.handleProps`. */
  handle?: boolean;
  /** Return `true` to lock an item: it cannot be dragged and does not move. */
  isItemDisabled?: (item: T) => boolean;
  /** Extra data attached to each drag, readable in engine callbacks. */
  getItemData?: (item: T) => DragData;
  /** Shown when there are no items. The container still accepts drops. */
  emptyState?: ReactNode;
  /**
   * The moving preview. `true` (default) clones `renderItem` into a portal; pass a function for
   * a custom preview or `false` to move the item itself.
   */
  overlay?: boolean | ((item: T) => ReactNode);
  overlayProps?: Omit<DragOverlayProps, "children">;
  /** Engine options and extra event handlers: sensors, modifiers, collision strategy, animation... */
  provider?: PresetProviderProps;
  /** Markup control: element or component for the container and the item wrappers. */
  containerAs?: ElementType;
  itemAs?: ElementType;
  className?: string;
  style?: CSSProperties;
  itemClassName?: string | ((item: T, state: SortableItemState) => string | undefined);
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

function layoutAxis(layout: SortableLayout): "x" | "y" | "grid" {
  return layout === "horizontal" ? "x" : layout === "grid" ? "grid" : "y";
}

interface ItemProps<T> {
  item: T;
  id: UniqueId;
  disabled: boolean;
  handle: boolean;
  data: DragData | undefined;
  as: ElementType;
  className: SortableListProps<T>["itemClassName"];
  renderItem: SortableListProps<T>["renderItem"];
}

function SortableListItem<T>({
  item,
  id,
  disabled,
  handle,
  data,
  as: Tag,
  className,
  renderItem,
}: ItemProps<T>): ReactNode {
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
  const wholeItem = handle ? {} : s.attributes;
  const resolvedClass = typeof className === "function" ? className(item, state) : className;
  return (
    <Tag
      ref={s.setNodeRef as Ref<HTMLElement>}
      style={s.style}
      className={resolvedClass}
      data-gripflow-item=""
      data-dragging={s.isDragging || undefined}
      data-over={s.isOver || undefined}
      data-invalid={s.isInvalidOver || undefined}
      data-disabled={disabled || undefined}
      data-drop-position={s.dropPosition ?? undefined}
      {...wholeItem}
    >
      {renderItem(item, state)}
    </Tag>
  );
}

interface BodyProps<T> extends SortableListProps<T> {
  list: readonly T[];
  containerId: UniqueId;
}

function SortableListBody<T>(props: BodyProps<T>): ReactNode {
  const {
    list,
    containerId,
    getId,
    renderItem,
    handle = false,
    isItemDisabled,
    getItemData,
    emptyState,
    containerAs: Container = "div",
    itemAs = "div",
    className,
    style,
    itemClassName,
    layout = "vertical",
  } = props;
  const container = useSortableContainer();
  return (
    <Container
      ref={container.setNodeRef as Ref<HTMLElement>}
      role="group"
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      className={className}
      style={style}
      data-gripflow-list=""
      data-layout={layout}
      data-container-id={String(containerId)}
      data-drop-target={container.isDropTarget || undefined}
      data-invalid={container.isInvalidOver || undefined}
      data-empty={list.length === 0 || undefined}
    >
      {list.map((item) => {
        const id = getId(item);
        return (
          <SortableListItem
            key={id}
            item={item}
            id={id}
            disabled={isItemDisabled?.(item) ?? false}
            handle={handle}
            data={getItemData?.(item)}
            as={itemAs}
            className={itemClassName}
            renderItem={renderItem}
          />
        );
      })}
      {list.length === 0 ? emptyState : null}
    </Container>
  );
}

/**
 * A ready-made sortable list, horizontal list or grid. It is a thin composition of the
 * `@gripflow/react` primitives, so anything it does you can do (and customize) with them.
 *
 * Markup and styling are yours: items receive `data-*` state attributes, the `renderItem`
 * render prop owns the content, and `styles.css` is an optional, zero-specificity starting point.
 */
export function SortableList<T>(props: SortableListProps<T>): ReactNode {
  const { id, layout = "vertical", overlay = true, overlayProps, renderItem, getId } = props;
  const containerId = id ?? "gripflow-list";
  const model = useSortableModel<T>({
    items: props.items,
    defaultItems: props.defaultItems,
    onItemsChange: props.onItemsChange,
    getId,
    containerId,
    provider: props.provider,
  });

  const renderOverlay = (activeId: UniqueId): ReactNode => {
    const item = model.byId.get(activeId);
    if (item === undefined) return null;
    if (typeof overlay === "function") return overlay(item);
    const state: SortableItemState = {
      index: model.ids.indexOf(activeId),
      isDragging: true,
      isOverlay: true,
      isOver: false,
      isInvalidOver: false,
      rejectionReason: null,
      disabled: false,
      dropPosition: null,
      handleProps: {
        role: "button",
        tabIndex: -1,
        "aria-roledescription": "sortable",
        "aria-describedby": "",
        "aria-disabled": false,
        "aria-pressed": true,
        ref: () => undefined,
        "data-gripflow-handle": "",
      },
    };
    return (
      <div data-gripflow-overlay="" data-layout={layout}>
        {renderItem(item, state)}
      </div>
    );
  };

  return (
    <DragDropProvider {...model.providerProps}>
      <SortableContext id={containerId} items={model.ids} axis={layoutAxis(layout)}>
        <SortableListBody {...props} list={model.items} containerId={containerId} />
      </SortableContext>
      {overlay === false ? null : (
        <DragOverlay {...overlayProps}>{(active) => renderOverlay(active.id)}</DragOverlay>
      )}
    </DragDropProvider>
  );
}

/** {@link SortableList} with `layout="grid"` as the default. */
export function SortableGrid<T>(props: Omit<SortableListProps<T>, "layout"> & { layout?: "grid" }): ReactNode {
  return <SortableList {...props} layout="grid" />;
}
