"use client";
import { clsx, type ClassValue } from "clsx";
import { Bookmark, Bug, CheckSquare, ChevronsUp, ChevronUp, Equal, ChevronDown, Layers, Minus, Square, X } from "lucide-react";
import { forwardRef, useLayoutEffect, useRef } from "react";
import { twMerge } from "tailwind-merge";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet" | "danger"; size?: "sm" | "md" };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "quiet", size = "md", className, ...p }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,box-shadow,filter] active:translate-y-px disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-9 px-3.5",
        variant === "primary" && "bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.12)] hover:brightness-110",
        variant === "quiet" && "border border-line bg-surface shadow-[0_1px_1px_rgb(0_0_0/0.04)] hover:bg-sunken",
        variant === "ghost" && "text-muted hover:bg-sunken hover:text-ink",
        variant === "danger" && "text-danger hover:bg-danger/10",
        className,
      )}
      {...p}
    />
  );
});

export const field =
  "w-full rounded-lg border border-line bg-surface px-3 py-1.5 shadow-[inset_0_1px_1px_rgb(0_0_0/0.03)] placeholder:text-muted/70 transition-shadow focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(field, "h-9", className)} {...p} />;
});

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(field, "h-9 py-0 pr-7", className)} {...p} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-b-2 border-line bg-surface px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Avatar({ name, image, size = 22 }: { name?: string | null; image?: string | null; size?: number }) {
  if (!name) return <span className="inline-block rounded-full border border-dashed border-muted/60" style={{ width: size, height: size }} title="Unassigned" />;
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt={name} title={name} width={size} height={size} className="rounded-full" />
  ) : (
    <span
      title={name}
      aria-label={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.55 0.09 ${hue})` }}
    >
      {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
    </span>
  );
}

/** Native <dialog>: focus trap, Esc and backdrop for free. */
export function Modal({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Layout effect: open/close synchronously so shortcuts never see a stale dialog[open].
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      // The native close event is async; ignore a stale one that arrives after a quick reopen.
      onClose={() => !ref.current?.open && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={cn("m-auto w-[min(640px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-rail/60 backdrop:backdrop-blur-[2px]", className)}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X size={16} />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// ---------- Issue vocabulary ----------

export const TYPE_META = {
  epic: { icon: Layers, color: "text-violet-600 dark:text-violet-400", label: "Epic" },
  story: { icon: Bookmark, color: "text-emerald-600 dark:text-emerald-400", label: "Story" },
  task: { icon: CheckSquare, color: "text-sky-600 dark:text-sky-400", label: "Task" },
  bug: { icon: Bug, color: "text-red-600 dark:text-red-400", label: "Bug" },
  subtask: { icon: Square, color: "text-slate-500", label: "Subtask" },
} as const;

export const PRIORITY_META = {
  urgent: { icon: ChevronsUp, color: "text-red-600 dark:text-red-400", label: "Urgent" },
  high: { icon: ChevronUp, color: "text-orange-600 dark:text-orange-400", label: "High" },
  medium: { icon: Equal, color: "text-amber-600 dark:text-amber-400", label: "Medium" },
  low: { icon: ChevronDown, color: "text-sky-600 dark:text-sky-400", label: "Low" },
  none: { icon: Minus, color: "text-muted", label: "No priority" },
} as const;

export const STATUS_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  blue: "bg-sky-500",
  violet: "bg-violet-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export function TypeIcon({ type, size = 15 }: { type: keyof typeof TYPE_META; size?: number }) {
  const m = TYPE_META[type];
  return <m.icon size={size} className={cn("shrink-0", m.color)} aria-label={m.label} />;
}

export function PriorityIcon({ priority, size = 15 }: { priority: keyof typeof PRIORITY_META; size?: number }) {
  const m = PRIORITY_META[priority];
  return <m.icon size={size} className={cn("shrink-0", m.color)} aria-label={m.label} />;
}

export function IssueKey({ k, className }: { k: string; className?: string }) {
  return <span className={cn("font-mono text-[12px] text-muted", className)}>{k}</span>;
}
