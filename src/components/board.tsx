"use client";
import {
  closestCorners,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, GripVertical, Plus, Trash2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useTRPC } from "@/trpc/react";
import { useShell } from "./shell";
import { Avatar, cn, IssueKey, PriorityIcon, STATUS_DOT, TypeIcon } from "./ui";

export type BoardIssue = {
  id: string;
  key: string;
  title: string;
  type: "epic" | "story" | "task" | "bug" | "subtask";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  statusId: string;
  estimate: number | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  labels: { id: string; name: string }[];
};
type Status = { id: string; name: string; color: string; category: string; wipLimit?: number | null };

type Props = {
  statuses: Status[];
  issues: BoardIssue[];
  onOpen: (key: string) => void;
  listKey: readonly unknown[];
  /** Set for a project board: lets admins drag column headers to reorder the workflow. */
  projectId?: string;
  /** Cross-project board: columns are categories, so a drop calls this instead of a ranked move. */
  moveToColumn?: (id: string, columnId: string) => Promise<unknown>;
};

const ACTIONS = [
  { id: "act:assign-me", label: "Assign to me", icon: UserCheck },
  { id: "act:unassign", label: "Unassign", icon: UserX },
  { id: "act:urgent", label: "Mark urgent", icon: Flame },
  { id: "act:delete", label: "Delete", icon: Trash2, danger: true },
] as const;

export function Board({ statuses, issues, onOpen, listKey, projectId, moveToColumn }: Props) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me, openCreate } = useShell();
  const readOnly = me.role === "guest";
  const canReorderColumns = !!projectId && me.role === "admin";
  const [order, setOrder] = useState(statuses.map((s) => s.id));
  useEffect(() => setOrder(statuses.map((s) => s.id)), [statuses]);
  const ordered = order.map((id) => statuses.find((s) => s.id === id)).filter((s): s is Status => !!s);
  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  const serverColumns = useMemo(() => {
    const cols: Record<string, string[]> = Object.fromEntries(statuses.map((s) => [s.id, []]));
    for (const i of issues) cols[i.statusId]?.push(i.id);
    return cols;
  }, [statuses, issues]);
  const [columns, setColumns] = useState(serverColumns);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overAction, setOverAction] = useState(false);
  useEffect(() => {
    if (!dragging) setColumns(serverColumns);
  }, [serverColumns, dragging]);

  const move = useMutation(
    trpc.issue.move.mutationOptions({
      onError: () => setColumns(serverColumns), // roll back; global handler toasts the reason
      onSettled: () => {
        qc.invalidateQueries({ queryKey: listKey });
        qc.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
      },
    }),
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
  };
  const update = useMutation(trpc.issue.update.mutationOptions({ onSettled: refresh }));
  const restore = useMutation(trpc.issue.restore.mutationOptions({ onSettled: refresh }));
  const remove = useMutation(
    trpc.issue.delete.mutationOptions({
      onSettled: refresh,
      onSuccess: (row) => toast(`Deleted ${byId.get(row.id)?.key ?? "issue"}`, { action: { label: "Undo", onClick: () => restore.mutate({ id: row.id }) } }),
    }),
  );
  const reorder = useMutation(
    trpc.workflow.reorder.mutationOptions({
      onError: () => setOrder(statuses.map((s) => s.id)),
      onSettled: () => qc.invalidateQueries({ queryKey: trpc.project.byKey.pathKey() }),
    }),
  );

  function runAction(action: string, id: string) {
    const i = byId.get(id);
    if (!i) return;
    if (action === "act:assign-me") update.mutate({ id, assigneeId: me.id }, { onSuccess: () => toast.success(`${i.key} assigned to you`) });
    if (action === "act:unassign") update.mutate({ id, assigneeId: null }, { onSuccess: () => toast.success(`${i.key} unassigned`) });
    if (action === "act:urgent") update.mutate({ id, priority: "urgent" }, { onSuccess: () => toast.success(`${i.key} marked urgent`) });
    if (action === "act:delete") remove.mutate({ id });
  }

  // Cards collide with the action dock first (pointer inside a target), then with cards/columns; column headers only with other headers.
  const collision: CollisionDetection = (args) => {
    const isCol = String(args.active.id).startsWith("col:");
    const pick = (f: (id: string) => boolean) => args.droppableContainers.filter((c) => f(String(c.id)));
    if (isCol) return closestCorners({ ...args, droppableContainers: pick((id) => id.startsWith("col:")) });
    const onAction = pointerWithin({ ...args, droppableContainers: pick((id) => id.startsWith("act:")) });
    if (onAction.length) return onAction;
    return closestCorners({ ...args, droppableContainers: pick((id) => !id.startsWith("act:") && !id.startsWith("col:")) });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const columnOf = (id: string) => (id in columns ? id : Object.keys(columns).find((c) => columns[c].includes(id)));

  function onDragOver({ active, over }: DragOverEvent) {
    setOverAction(!!over && String(over.id).startsWith("act:"));
    if (!over || String(active.id).startsWith("col:") || String(over.id).startsWith("act:")) return;
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((c) => {
      const target = c[to];
      const overIndex = target.indexOf(String(over.id));
      const at = overIndex === -1 ? target.length : overIndex;
      return { ...c, [from]: c[from].filter((x) => x !== active.id), [to]: [...target.slice(0, at), String(active.id), ...target.slice(at)] };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    setOverAction(false);
    const id = String(active.id);
    if (id.startsWith("col:")) {
      if (!over || over.id === active.id || !String(over.id).startsWith("col:")) return;
      const next = arrayMove(order, order.indexOf(id.slice(4)), order.indexOf(String(over.id).slice(4)));
      setOrder(next);
      reorder.mutate({ projectId: projectId!, order: next });
      return;
    }
    if (over && String(over.id).startsWith("act:")) {
      setColumns(serverColumns);
      return runAction(String(over.id), id);
    }
    const col = columnOf(id);
    if (!over || !col) return setColumns(serverColumns);
    if (moveToColumn) {
      if (byId.get(id)?.statusId === col) return setColumns(serverColumns); // no ranking across projects
      moveToColumn(id, col).catch(() => setColumns(serverColumns));
      return;
    }
    let list = columns[col];
    const oldIndex = list.indexOf(id);
    const overIndex = list.indexOf(String(over.id));
    if (overIndex !== -1 && overIndex !== oldIndex) {
      list = [...list];
      list.splice(oldIndex, 1);
      list.splice(overIndex, 0, id);
      setColumns((c) => ({ ...c, [col]: list }));
    }
    const i = list.indexOf(id);
    const original = byId.get(id);
    if (original?.statusId === col && serverColumns[col].indexOf(id) === i) return; // no-op drop
    move.mutate({ id, statusId: col, afterId: list[i - 1] ?? null, beforeId: list[i + 1] ?? null });
  }

  const active = dragging && !dragging.startsWith("col:") ? byId.get(dragging) : null;
  const draggingColumn = dragging?.startsWith("col:") ? statuses.find((s) => `col:${s.id}` === dragging) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => (setDragging(null), setOverAction(false), setColumns(serverColumns))}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${byId.get(String(active.id))?.key ?? "column"}. Drop on a column, or on an action at the bottom.`,
          onDragOver: ({ over }) => (over ? `Over ${statuses.find((s) => s.id === columnOf(String(over.id)))?.name}.` : ""),
          onDragEnd: ({ active, over }) =>
            !over ? "Drop cancelled." : String(over.id).startsWith("act:") ? `${ACTIONS.find((a) => a.id === over.id)?.label}: ${byId.get(String(active.id))?.key}.` : `Dropped ${byId.get(String(active.id))?.key ?? "column"}.`,
          onDragCancel: () => "Drop cancelled.",
        },
      }}
    >
      <SortableContext items={ordered.map((s) => `col:${s.id}`)} strategy={horizontalListSortingStrategy} disabled={!canReorderColumns}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 md:px-6">
          {ordered.map((s) => (
            <Column key={s.id} status={s} ids={columns[s.id] ?? []} byId={byId} onOpen={onOpen} readOnly={readOnly} canDrag={canReorderColumns} onAdd={() => openCreate()} />
          ))}
        </div>
      </SortableContext>
      {!readOnly && <ActionDock visible={!!active} />}
      <DragOverlay>
        {active && (
          // Shrink out of the way over the dock so the highlighted action stays visible.
          <div className={cn("origin-top-left transition-transform duration-150", overAction && "translate-y-[-70px] scale-50 opacity-80")}>
            <Card issue={active} overlay />
          </div>
        )}
        {draggingColumn && (
          <div className="flex w-[296px] items-center gap-2 rounded-xl border border-line bg-surface px-3 py-3 shadow-xl ring-2 ring-lime">
            <span className={cn("size-2 rounded-full", STATUS_DOT[draggingColumn.color])} aria-hidden />
            <span className="font-[family-name:var(--font-display)] font-semibold">{draggingColumn.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function ActionDock({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        // Fade only: dnd-kit measures drop targets when the drag starts, so the dock must not move.
        "pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className={cn("flex gap-2 rounded-2xl border border-rail-line bg-rail p-2 shadow-2xl", visible && "pointer-events-auto")}>
        {ACTIONS.map((a) => (
          <DockTarget key={a.id} {...a} />
        ))}
      </div>
    </div>
  );
}

function DockTarget({ id, label, icon: Icon, danger }: { id: string; label: string; icon: typeof Trash2; danger?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-24 flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-2 text-[12px] font-medium transition-all",
        isOver
          ? danger
            ? "scale-105 border-danger bg-danger text-white"
            : "scale-105 border-lime bg-lime text-lime-ink"
          : "border-rail-line text-rail-muted",
      )}
    >
      <Icon size={18} />
      {label}
    </div>
  );
}

function Column({
  status,
  ids,
  byId,
  onOpen,
  readOnly,
  canDrag,
  onAdd,
}: {
  status: Status;
  ids: string[];
  byId: Map<string, BoardIssue>;
  onOpen: (k: string) => void;
  readOnly: boolean;
  canDrag: boolean;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id, disabled: readOnly });
  const sortable = useSortable({ id: `col:${status.id}`, disabled: !canDrag });
  const points = ids.reduce((n, id) => n + (byId.get(id)?.estimate ?? 0), 0);
  return (
    <section
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      aria-label={status.name}
      className={cn("relative flex min-w-[272px] flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-line/70 bg-sunken/70", sortable.isDragging && "opacity-40")}
    >
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", STATUS_DOT[status.color])} aria-hidden />
      <header className="group/col flex items-center gap-2 px-3 pt-3.5 pb-2">
        {canDrag && (
          <button
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Reorder ${status.name} column`}
            className="-ml-1.5 cursor-grab rounded p-0.5 text-muted opacity-0 group-hover/col:opacity-100 focus:opacity-100 hover:bg-surface active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </button>
        )}
        <span className={cn("size-2 rounded-full", STATUS_DOT[status.color])} aria-hidden />
        <h2 className="text-[15px] font-semibold">{status.name}</h2>
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
            status.wipLimit && ids.length > status.wipLimit ? "bg-danger/15 text-danger" : "bg-surface text-muted",
          )}
          title={status.wipLimit ? `WIP limit ${status.wipLimit}` : undefined}
        >
          {ids.length}
          {status.wipLimit ? ` / ${status.wipLimit}` : ""}
        </span>
        {points > 0 && <span className="text-[12px] text-muted">· {points} pts</span>}
        {!readOnly && status.category === "todo" && (
          <button onClick={onAdd} aria-label={`Add issue to ${status.name}`} className="ml-auto rounded-md p-1 text-muted hover:bg-surface hover:text-ink">
            <Plus size={15} />
          </button>
        )}
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
        <ol ref={setNodeRef} className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors",
            isOver && "bg-accent-soft/60",
            status.wipLimit && ids.length > status.wipLimit && "bg-danger/5",
          )}>
          {ids.map((id) => {
            const issue = byId.get(id);
            return issue ? <SortableCard key={id} issue={issue} onOpen={onOpen} readOnly={readOnly} /> : null;
          })}
          {!ids.length && <li className="m-1 rounded-lg border border-dashed border-line py-6 text-center text-[12px] text-muted">Drop issues here</li>}
        </ol>
      </SortableContext>
    </section>
  );
}

function SortableCard({ issue, onOpen, readOnly }: { issue: BoardIssue; onOpen: (k: string) => void; readOnly: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled: readOnly });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-30")}>
      <Card
        issue={issue}
        dragProps={{ ...attributes, ...listeners }}
        onOpen={() => onOpen(issue.key)}
      />
    </li>
  );
}

function Card({ issue, overlay, dragProps, onOpen }: { issue: BoardIssue; overlay?: boolean; dragProps?: object; onOpen?: () => void }) {
  const overdue = issue.dueDate && new Date(issue.dueDate) < new Date(new Date().toDateString());
  return (
    <div
      {...dragProps}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Space/Enter are taken by dnd-kit's keyboard sensor; "o" opens.
        if (e.key === "o") onOpen?.();
      }}
      aria-roledescription="Issue card. Press space to move, o to open."
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-lg border border-line/80 bg-surface p-3 shadow-[0_1px_2px_rgb(19_33_26/0.06)] transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:border-line hover:shadow-[0_6px_16px_-6px_rgb(19_33_26/0.18)]",
        overlay && "rotate-2 cursor-grabbing shadow-xl ring-2 ring-lime",
      )}
    >
      {(issue.priority === "urgent" || issue.priority === "high") && (
        <span className={cn("absolute inset-y-0 left-0 w-[3px]", issue.priority === "urgent" ? "bg-danger" : "bg-warn")} aria-hidden />
      )}
      <p className="mb-2.5 line-clamp-3 font-medium leading-snug">{issue.title}</p>
      {issue.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {issue.labels.map((l) => (
            <span key={l.id} className="rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <TypeIcon type={issue.type} size={14} />
        <IssueKey k={issue.key} />
        {issue.dueDate && (
          <span className={cn("rounded-md px-1 text-[11px] tabular-nums", overdue ? "bg-danger/10 font-semibold text-danger" : "text-muted")}>{issue.dueDate.slice(5)}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {issue.estimate != null && <span className="grid size-5 place-items-center rounded-full bg-sunken text-[10px] font-semibold text-muted">{issue.estimate}</span>}
          <PriorityIcon priority={issue.priority} size={14} />
          <Avatar name={issue.assigneeName} image={issue.assigneeImage} size={20} />
        </span>
      </div>
    </div>
  );
}
