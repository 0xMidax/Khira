"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/react";
import { Button, IssueKey } from "./ui";

type Running = { issueId: string; key: string; title: string; startedAt: number };
const STORE = "khira:focus";

const read = (): Running | null => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "null");
  } catch {
    return null;
  }
};
const store = (r: Running | null) => {
  try {
    if (r) localStorage.setItem(STORE, JSON.stringify(r));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: timer still works for this tab */
  }
};

/** One focus timer at a time; survives reloads (localStorage) and logs the time when stopped. */
export function useFocus() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [running, setRunning] = useState<Running | null>(null);
  const [, tick] = useState(0);
  useEffect(() => setRunning(read()), []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const log = useMutation(trpc.time.log.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.time.pathKey() }) }));

  const stop = () => {
    if (!running) return;
    const minutes = Math.round((Date.now() - running.startedAt) / 60_000);
    store(null);
    setRunning(null);
    if (minutes < 1) return toast("Under a minute, so nothing was logged.");
    log.mutate({ issueId: running.issueId, minutes: Math.min(minutes, 24 * 60), note: "Focus timer" }, { onSuccess: () => toast.success(`Logged ${minutes}m on ${running.key}`) });
  };
  const start = (r: Omit<Running, "startedAt">) => {
    if (running) stop();
    const next = { ...r, startedAt: Date.now() };
    store(next);
    setRunning(next);
  };
  return { running, start, stop };
}

export function FocusBar({ running, stop }: { running: Running | null; stop: () => void }) {
  if (!running) return null;
  const s = Math.floor((Date.now() - running.startedAt) / 1000);
  const clock = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-accent bg-accent-soft px-4 py-3" role="timer" aria-live="off">
      <span className="font-mono text-xl tabular-nums">{clock}</span>
      <span className="min-w-0 flex-1 truncate">
        Focusing on <IssueKey k={running.key} /> {running.title}
      </span>
      <Button variant="primary" onClick={stop}>
        <Pause size={14} /> Stop and log
      </Button>
    </div>
  );
}

export function FocusButton({ onStart, active }: { onStart: () => void; active: boolean }) {
  return (
    <button
      onClick={(e) => (e.preventDefault(), onStart())}
      aria-label={active ? "Timer running" : "Start focus timer"}
      title={active ? "Timer running" : "Start focus timer"}
      className={active ? "text-accent" : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-accent"}
    >
      <Play size={14} />
    </button>
  );
}
