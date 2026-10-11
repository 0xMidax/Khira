"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isOnScreen, placePopover, type Rect } from "@/lib/tour";
import { Button, Kbd } from "./ui";

type Step = { title: string; body: React.ReactNode; target?: string; path?: string };

const DONE_KEY = "khira:tour-done";
export const tourDone = () => {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag
  }
};

export function buildSteps(projectKey?: string): Step[] {
  const p = projectKey;
  return [
    {
      title: "Welcome to Khira",
      body: "This quick tour shows where everything lives and how a piece of work moves from idea to done. It takes about two minutes. Use the arrow keys or the buttons, and press Esc to stop anytime.",
    },
    {
      target: '[data-tour="new-issue"]',
      title: "Capture work as issues",
      body: (
        <>
          Every task, bug or idea is an <b>issue</b>. Press <Kbd>C</Kbd> anywhere to create one. Paste rough notes and choose “Write from notes” to let AI draft it, and Khira warns you if a similar issue already exists.
        </>
      ),
    },
    {
      target: '[data-tour="search"]',
      title: "Jump anywhere",
      body: (
        <>
          Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> (or <Kbd>/</Kbd>) to search issues by key or text and jump to any project.
        </>
      ),
    },
    {
      target: '[data-tour="nav-/"]',
      path: "/",
      title: "My work",
      body: "Your open issues, grouped into overdue, in progress and up next. Hover an issue and press ▶ to start a focus timer; the time is logged when you stop.",
    },
    {
      target: '[data-tour="nav-/board"]',
      title: "Team board",
      body: "Every project’s work on one Kanban board, by To do, In progress and Done. Filter to just your issues or a few projects, and drag cards across columns.",
    },
    {
      target: '[data-tour="nav-/inbox"]',
      title: "Notifications",
      body: "Mentions, assignments and changes to issues you watch land here (and by email or push, if you turn those on in Your settings).",
    },
    {
      target: '[data-tour="nav-/triage"]',
      title: "Triage",
      body: "Issues that arrive from email, Slack or outside the team wait here until someone sets the basics and accepts them onto the board.",
    },
    {
      target: '[data-tour="projects-list"]',
      title: "Projects",
      body: p
        ? "Each project has its own board, backlog, workflow and reports. Let’s open one."
        : "Work is organised into projects. Create your first one under Projects, then replay this tour to see the board.",
    },
    ...(p
      ? [
          {
            path: `/p/${p}`,
            target: '[data-tour="views"]',
            title: "Three ways to see a project",
            body: "Board shows work by status. Backlog is for planning sprints. List is a compact table you can sort and scan.",
          },
          {
            path: `/p/${p}`,
            target: "main section[aria-label]",
            title: "Move work across the board",
            body: (
              <>
                Drag a card to the next column as work progresses. With the keyboard, focus a card, press <Kbd>Space</Kbd>, use the arrow keys, then <Kbd>Space</Kbd> again. While dragging, drop a card on the bar at the bottom to assign it to yourself, unassign it, mark it urgent or delete it. Admins can drag a column’s header to reorder the workflow. Click a card to open it.
              </>
            ),
          },
          {
            path: `/p/${p}`,
            target: '[data-tour="filters"]',
            title: "Filter the board",
            body: "Narrow the board by text, person, type, priority or label. When a sprint is running, the board shows that sprint, and you can switch to all issues.",
          },
          {
            path: `/p/${p}?view=backlog`,
            target: 'section[aria-label="Backlog"]',
            title: "Plan sprints in the backlog",
            body: "Create a sprint, drag issues into it, then start it with dates and a goal. When it ends, unfinished work moves to the next sprint or back here.",
          },
          {
            path: `/p/${p}`,
            target: '[data-tour="project-links"]',
            title: "Releases, retros and reports",
            body: "Releases group finished work and write the release notes. Retro is the end-of-sprint board. Reports shows burndown, velocity, flow and cycle time. Admins also see Settings for workflows, automation and integrations.",
          },
        ]
      : []),
    {
      target: '[data-tour="nav-/dashboards"]',
      title: "Dashboards, timeline, calendar and standups",
      body: "Build team dashboards from saved queries, plan epics on the timeline, see due dates on the calendar, and read daily standups drafted from everyone’s activity.",
    },
    {
      target: '[data-tour="nav-/settings/profile"]',
      title: "Make it yours",
      body: "Choose how you’re notified (each update, a daily digest, or never), turn on push for this device, and link your Slack and GitHub accounts.",
    },
    {
      path: "/",
      title: "You’re ready",
      body: (
        <>
          Shortcuts to remember: <Kbd>C</Kbd> new issue, <Kbd>⌘</Kbd> <Kbd>K</Kbd> search, and on an issue <Kbd>A</Kbd> assign to me, <Kbd>S</Kbd> status, <Kbd>M</Kbd> comment. You can replay this tour from the sidebar anytime.
        </>
      ),
    },
  ];
}

const SIZE = { width: 340, height: 230 };

export function Tour({ open, onClose, projectKey }: { open: boolean; onClose: () => void; projectKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const steps = buildSteps(projectKey);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[Math.min(i, steps.length - 1)];

  const finish = useCallback(() => {
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {}
    setI(0);
    setRect(null);
    onClose();
  }, [onClose]);

  // Go to the step's page, then wait (up to ~4s) for its target to render.
  useEffect(() => {
    if (!open) return;
    if (step.path) {
      const [path, query] = step.path.split("?");
      const here = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
      if (path !== pathname || (query ?? "") !== here) router.push(step.path);
    }
    setRect(null);
    if (!step.target) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.querySelector(step.target!);
      if (el || ++tries > 40) {
        clearInterval(t);
        if (el) {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
          const r = el.getBoundingClientRect();
          setRect(isOnScreen(r, { width: innerWidth, height: innerHeight }) ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
        }
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per step, not on every navigation tick
  }, [open, i]);

  // Keep the spotlight glued to its target on resize/scroll.
  useEffect(() => {
    if (!open || !step.target) return;
    const update = () => {
      const el = document.querySelector(step.target!);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect(isOnScreen(r, { width: innerWidth, height: innerHeight }) ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    addEventListener("resize", update);
    addEventListener("scroll", update, true);
    return () => {
      removeEventListener("resize", update);
      removeEventListener("scroll", update, true);
    };
  }, [open, step.target]);

  useLayoutEffect(() => {
    if (open) nextRef.current?.focus();
  }, [open, i, rect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
      else return;
      e.preventDefault();
      e.stopPropagation(); // keep the app's own shortcuts quiet during the tour
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [open, finish, steps.length]);

  if (!open) return null;
  const last = i === steps.length - 1;
  const vp = { width: typeof window === "undefined" ? 1024 : innerWidth, height: typeof window === "undefined" ? 768 : innerHeight };
  const size = { width: Math.min(SIZE.width, vp.width - 32), height: SIZE.height };
  const pos = rect ? placePopover(rect, vp, size) : null;

  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* Spotlight: one box with a huge shadow dims everything except the target. */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }}
          aria-hidden
        />
      ) : (
        <div className="fixed inset-0 bg-black/50" aria-hidden />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="fixed rounded-xl border border-line bg-surface p-4 text-ink shadow-2xl"
        style={pos ? { width: size.width, left: pos.left, top: pos.top } : { width: size.width, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="mb-1 text-[12px] text-muted">
          Step {i + 1} of {steps.length}
        </div>
        <h2 id="tour-title" className="mb-1.5 text-base font-semibold">
          {step.title}
        </h2>
        <div className="mb-4 text-[13px] leading-relaxed text-ink/90">{step.body}</div>
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
          <button className="text-[13px] text-muted hover:text-ink" onClick={finish}>
            {last ? "Close" : "Skip tour"}
          </button>
          <span className="ml-auto" />
          {i > 0 && (
            <Button size="sm" onClick={() => setI(i - 1)}>
              Back
            </Button>
          )}
          <Button ref={nextRef} size="sm" variant="primary" onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
