"use client";
import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/react";
import type { BoardIssue } from "./board";
import { useShell } from "./shell";
import { Avatar, Button, cn, Input, IssueKey, Modal, PriorityIcon, Select, STATUS_DOT, TypeIcon } from "./ui";

type Issue = BoardIssue & { sprintId: string | null };
type Status = { id: string; name: string; color: string; category: string };
const BACKLOG = "backlog";
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function Backlog({ projectId, statuses, issues, onOpen, listKey }: { projectId: string; statuses: Status[]; issues: Issue[]; onOpen: (k: string) => void; listKey: readonly unknown[] }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const readOnly = me.role === "guest";
  const sprints = useQuery(trpc.sprint.list.queryOptions({ projectId }));
  const statusOf = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  const openSprints = useMemo(() => sprints.data?.map((s) => s.sprint) ?? [], [sprints.data]);

  // Done issues stay in their sprint (they count toward it) but not in the backlog list.
  const serverGroups = useMemo(() => {
    const g: Record<string, string[]> = { [BACKLOG]: [], ...Object.fromEntries(openSprints.map((s) => [s.id, []])) };
    for (const i of issues) {
      const key = i.sprintId && g[i.sprintId] ? i.sprintId : BACKLOG;
      if (key === BACKLOG && statusOf.get(i.statusId)?.category === "done") continue;
      if (key === BACKLOG && i.sprintId) continue; // in a closed sprint
      g[key].push(i.id);
    }
    return g;
  }, [issues, openSprints, statusOf]);
  const [groups, setGroups] = useState(serverGroups);
  const [dragging, setDragging] = useState<string | null>(null);
  useEffect(() => {
    if (!dragging) setGroups(serverGroups);
  }, [serverGroups, dragging]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: listKey });
    qc.invalidateQueries({ queryKey: trpc.sprint.pathKey() });
  };
  const move = useMutation(trpc.issue.move.mutationOptions({ onError: () => setGroups(serverGroups), onSettled: refresh }));
  const createSprint = useMutation(trpc.sprint.create.mutationOptions({ onSuccess: refresh }));
  const deleteSprint = useMutation(trpc.sprint.delete.mutationOptions({ onSuccess: refresh }));
  const [starting, setStarting] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const groupOf = (id: string) => (id in groups ? id : Object.keys(groups).find((g) => groups[g].includes(id)));

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = groupOf(String(active.id));
    const to = groupOf(String(over.id));
    if (!from || !to || from === to) return;
    setGroups((g) => {
      const at = g[to].indexOf(String(over.id));
      const target = [...g[to]];
      target.splice(at === -1 ? target.length : at, 0, String(active.id));
      return { ...g, [from]: g[from].filter((x) => x !== active.id), [to]: target };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const id = String(active.id);
    const g = groupOf(id);
    if (!over || !g) return setGroups(serverGroups);
    let list = groups[g];
    const oldIndex = list.indexOf(id);
    const overIndex = list.indexOf(String(over.id));
    if (overIndex !== -1 && overIndex !== oldIndex) {
      list = [...list];
      list.splice(oldIndex, 1);
      list.splice(overIndex, 0, id);
      setGroups((x) => ({ ...x, [g]: list }));
    }
    const i = list.indexOf(id);
    const sprintId = g === BACKLOG ? null : g;
    if ((byId.get(id)?.sprintId ?? null) === sprintId && serverGroups[g]?.indexOf(id) === i) return;
    move.mutate({ id, sprintId, afterId: list[i - 1] ?? null, beforeId: list[i + 1] ?? null });
  }

  const section = (key: string, title: React.ReactNode, actions?: React.ReactNode, meta?: React.ReactNode) => {
    const ids = groups[key] ?? [];
    const pts = ids.reduce((n, id) => n + (byId.get(id)?.estimate ?? 0), 0);
    return (
      <Section key={key} id={key} readOnly={readOnly}>
        <header className="flex flex-wrap items-center gap-2 px-3 py-2">
          <ChevronDown size={14} className="text-muted" aria-hidden />
          <h2 className="font-medium">{title}</h2>
          <span className="text-[12px] text-muted">
            {ids.length} issues{pts ? ` · ${pts} pts` : ""}
          </span>
          {meta}
          <span className="ml-auto flex gap-1.5">{actions}</span>
        </header>
        <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
          <ol className="min-h-10 divide-y divide-line border-t border-line">
            {ids.map((id) => {
              const i = byId.get(id);
              return i ? <Row key={id} issue={i} status={statusOf.get(i.statusId)} onOpen={onOpen} readOnly={readOnly} /> : null;
            })}
            {!ids.length && <li className="px-3 py-4 text-center text-[12px] text-muted">{key === BACKLOG ? "Your backlog is empty." : "Drag issues here to plan this sprint."}</li>}
          </ol>
        </SortableContext>
      </Section>
    );
  };

  const hasActive = openSprints.some((s) => s.state === "active");
  const active = dragging ? byId.get(dragging) : null;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-8 md:px-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => setDragging(String(e.active.id))}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => (setDragging(null), setGroups(serverGroups))}
      >
        <div className="space-y-4">
          {openSprints.map((s) =>
            section(
              s.id,
              s.name,
              !readOnly && (
                <>
                  {s.state === "active" ? (
                    <Button size="sm" onClick={() => setCompleting(s.id)}>
                      Complete sprint
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" disabled={hasActive} title={hasActive ? "Complete the active sprint first" : undefined} onClick={() => setStarting(s.id)}>
                        <Play size={13} /> Start sprint
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => deleteSprint.mutate({ id: s.id })}>
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </>
              ),
              <>
                {s.state === "active" && <span className="rounded-full bg-accent-soft px-2 text-[11px] font-medium text-accent">Active</span>}
                {s.startDate && (
                  <span className="text-[12px] text-muted">
                    {s.startDate} → {s.endDate}
                  </span>
                )}
                {s.goal && <span className="truncate text-[12px] text-muted">· {s.goal}</span>}
              </>,
            ),
          )}
          {section(
            BACKLOG,
            "Backlog",
            !readOnly && (
              <Button size="sm" onClick={() => createSprint.mutate({ projectId })}>
                <Plus size={13} /> Create sprint
              </Button>
            ),
          )}
        </div>
        <DragOverlay>{active && <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg">{active.title}</div>}</DragOverlay>
      </DndContext>

      <StartSprint sprint={openSprints.find((s) => s.id === starting)} onClose={() => setStarting(null)} onDone={refresh} />
      <CompleteSprint
        sprint={openSprints.find((s) => s.id === completing)}
        targets={openSprints.filter((s) => s.state === "planned")}
        unfinished={(groups[completing ?? ""] ?? []).filter((id) => statusOf.get(byId.get(id)?.statusId ?? "")?.category !== "done").length}
        done={issues.filter((i) => i.sprintId === completing && statusOf.get(i.statusId)?.category === "done").length}
        onClose={() => setCompleting(null)}
        onDone={refresh}
      />
    </div>
  );
}

function Section({ id, readOnly, children }: { id: string; readOnly: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: readOnly });
  return (
    <section ref={setNodeRef} aria-label={id === BACKLOG ? "Backlog" : undefined} className={cn("rounded-lg border border-line bg-surface", isOver && "ring-2 ring-accent")}>
      {children}
    </section>
  );
}

function Row({ issue, status, onOpen, readOnly }: { issue: Issue; status?: Status; onOpen: (k: string) => void; readOnly: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled: readOnly });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(issue.key)}
      onKeyDown={(e) => e.key === "o" && onOpen(issue.key)}
      className={cn("flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-sunken", isDragging && "opacity-30")}
    >
      <TypeIcon type={issue.type} size={14} />
      <IssueKey k={issue.key} className="w-20 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", status?.category === "done" && "text-muted line-through")}>{issue.title}</span>
      {status && (
        <span className="hidden items-center gap-1.5 text-[12px] text-muted sm:flex">
          <span className={cn("size-2 rounded-full", STATUS_DOT[status.color])} aria-hidden />
          {status.name}
        </span>
      )}
      <PriorityIcon priority={issue.priority} size={14} />
      {issue.estimate != null && <span className="w-6 rounded bg-sunken text-center text-[11px] text-muted">{issue.estimate}</span>}
      <Avatar name={issue.assigneeName} image={issue.assigneeImage} size={20} />
    </li>
  );
}

function StartSprint({ sprint, onClose, onDone }: { sprint?: { id: string; name: string; goal: string | null }; onClose: () => void; onDone: () => void }) {
  const trpc = useTRPC();
  const start = useMutation(trpc.sprint.start.mutationOptions({ onSuccess: (s) => (toast.success(`${s.name} started`), onDone(), onClose()) }));
  const today = new Date();
  return (
    <Modal open={!!sprint} onClose={onClose} title={`Start ${sprint?.name ?? "sprint"}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          start.mutate({ id: sprint!.id, startDate: String(f.get("start")), endDate: String(f.get("end")), goal: String(f.get("goal") || "") || undefined });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="mb-1 block text-[12px] text-muted">Starts</span>
            <Input type="date" name="start" required defaultValue={iso(today)} />
          </label>
          <label>
            <span className="mb-1 block text-[12px] text-muted">Ends</span>
            <Input type="date" name="end" required defaultValue={iso(new Date(today.getTime() + 13 * 86_400_000))} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Sprint goal</span>
          <Input name="goal" defaultValue={sprint?.goal ?? ""} placeholder="What should be true at the end of this sprint?" maxLength={500} />
        </label>
        <div className="flex justify-end">
          <Button variant="primary" disabled={start.isPending}>
            Start sprint
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteSprint(props: {
  sprint?: { id: string; name: string };
  targets: { id: string; name: string }[];
  unfinished: number;
  done: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const complete = useMutation(
    trpc.sprint.complete.mutationOptions({
      onSuccess: (r) => (toast.success(`${r.sprint.name} completed${r.carriedOver ? ` · ${r.carriedOver} carried over` : ""}`), props.onDone(), props.onClose()),
    }),
  );
  return (
    <Modal open={!!props.sprint} onClose={props.onClose} title={`Complete ${props.sprint?.name ?? "sprint"}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const to = new FormData(e.currentTarget).get("to");
          complete.mutate({ id: props.sprint!.id, moveTo: !to || to === BACKLOG ? null : String(to) });
        }}
      >
        <p>
          {props.done} done · {props.unfinished} unfinished.
        </p>
        {props.unfinished > 0 && (
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Move unfinished issues to</span>
            <Select name="to" defaultValue={props.targets[0]?.id ?? BACKLOG}>
              {props.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value={BACKLOG}>Backlog</option>
            </Select>
          </label>
        )}
        <div className="flex justify-end">
          <Button variant="primary" disabled={complete.isPending}>
            Complete sprint
          </Button>
        </div>
      </form>
    </Modal>
  );
}
