"use client";
import Link from "next/link";
import { Avatar, cn, IssueKey, PriorityIcon, STATUS_DOT, TypeIcon } from "./ui";

type Row = {
  id: string;
  key: string;
  title: string;
  type: "epic" | "story" | "task" | "bug" | "subtask";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  statusName: string;
  statusColor: string;
  statusCategory: string;
  assigneeName: string | null;
  assigneeImage: string | null;
  dueDate: string | null;
};

export function IssueResults({ rows, empty }: { rows: Row[]; empty?: string }) {
  if (!rows.length) return <p className="py-8 text-center text-muted">{empty ?? "No issues match."}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden card">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/i/${r.key}`} className="flex items-center gap-3 px-3 py-2 hover:bg-sunken">
            <TypeIcon type={r.type} size={14} />
            <IssueKey k={r.key} className="w-20 shrink-0" />
            <span className={cn("min-w-0 flex-1 truncate", r.statusCategory === "done" && "text-muted line-through")}>{r.title}</span>
            <span className="hidden items-center gap-1.5 text-[12px] text-muted sm:flex">
              <span className={cn("size-2 rounded-full", STATUS_DOT[r.statusColor])} aria-hidden />
              {r.statusName}
            </span>
            {r.dueDate && <span className="hidden text-[12px] text-muted md:inline">{r.dueDate}</span>}
            <PriorityIcon priority={r.priority} size={14} />
            <Avatar name={r.assigneeName} image={r.assigneeImage} size={20} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
