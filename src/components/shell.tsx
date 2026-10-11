"use client";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { ArchiveRestore as TriageIcon, Bell, CalendarDays, ChartGantt, Columns3, FolderKanban, GraduationCap, Inbox, LayoutDashboard, LogOut, Megaphone, Menu, Plug, Plus, Search, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/trpc/react";
import { CreateIssueDialog } from "./create-issue";
import { liveEnabled, useLiveUpdates } from "./live";
import { Tour, tourDone } from "./tour";
import { Slice } from "./brand";
import { Avatar, Button, cn, IssueKey, Kbd, TypeIcon } from "./ui";

type Me = { id: string; name: string; image?: string | null; role: string };
const ShellCtx = createContext<{ me: Me; openCreate: (projectId?: string) => void }>(null!);
export const useShell = () => useContext(ShellCtx);

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const [create, setCreate] = useState<{ open: boolean; projectId?: string }>({ open: false });
  const [palette, setPalette] = useState(false);
  const [nav, setNav] = useState(false);
  const pathname = usePathname();
  const trpc = useTRPC();
  const projects = useQuery(trpc.project.list.queryOptions());
  const unread = useQuery({ ...trpc.notification.unreadCount.queryOptions(), refetchInterval: liveEnabled ? false : 30_000 });
  const triage = useQuery({ ...trpc.search.query.queryOptions({ kql: "triage = true", limit: 100 }), refetchInterval: liveEnabled ? false : 60_000 });
  useLiveUpdates(me.id, projects.data?.map((p) => p.id) ?? []);

  // Current project from /p/KEY or /i/KEY-12, so "c" defaults to it.
  const key = /^\/(?:p|i)\/([A-Za-z0-9]+)/.exec(pathname)?.[1]?.toUpperCase();
  const currentProjectId = projects.data?.find((p) => p.key === key)?.id;
  const openCreate = (projectId?: string) => setCreate({ open: true, projectId: projectId ?? currentProjectId });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
      } else if (!isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector("dialog[open]")) {
        if (e.key === "c") {
          e.preventDefault();
          openCreate();
        } else if (e.key === "/") {
          e.preventDefault();
          setPalette(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => setNav(false), [pathname]);
  const [tour, setTour] = useState<{ open: boolean; key?: string }>({ open: false });
  const [showTourDot, setShowTourDot] = useState(false);
  useEffect(() => setShowTourDot(!tourDone()), [tour.open]);
  const startTour = () => {
    setNav(false);
    setPalette(false);
    setTour({ open: true, key: key ?? projects.data?.[0]?.key });
  };
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const link = (href: string, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <Link
      href={href}
      data-tour={`nav-${href}`}
      aria-current={pathname === href ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-rail-muted transition-colors hover:bg-rail-hover hover:text-rail-ink",
        pathname === href && "bg-rail-hover font-medium text-white before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-lime",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {extra}
    </Link>
  );

  return (
    <ShellCtx.Provider value={{ me, openCreate }}>
      <div className="flex min-h-dvh">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-rail p-3 text-rail-ink transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0",
            nav ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-5 flex items-center gap-2.5 px-2 pt-1.5">
            <Slice size={26} />
            <span className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white">khira</span>
          </div>
          <div className="mb-3 flex gap-1.5">
            <Button className="flex-1 bg-lime font-semibold text-lime-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.4)] hover:brightness-105" data-tour="new-issue" onClick={() => openCreate()}>
              <Plus size={16} strokeWidth={2.5} /> New issue
            </Button>
            <Button className="border border-rail-line bg-transparent text-rail-muted hover:bg-rail-hover hover:text-rail-ink" aria-label="Search (⌘K)" data-tour="search" onClick={() => setPalette(true)}>
              <Search size={15} />
            </Button>
          </div>
          <nav className="space-y-0.5">
            {link("/", <Inbox size={16} />, "My work")}
            {link(
              "/inbox",
              <Bell size={16} />,
              "Notifications",
              !!unread.data && <span className="rounded-full bg-lime px-1.5 text-[11px] font-bold text-lime-ink">{unread.data}</span>,
            )}
            {link(
              "/triage",
              <TriageIcon size={16} />,
              "Triage",
              !!triage.data?.length && <span className="rounded-full bg-rail-line px-1.5 text-[11px] font-semibold text-rail-ink">{triage.data.length}</span>,
            )}
            {link("/board", <Columns3 size={16} />, "Team board")}
            {link("/projects", <FolderKanban size={16} />, "Projects")}
            {link("/dashboards", <LayoutDashboard size={16} />, "Dashboards")}
            {link("/timeline", <ChartGantt size={16} />, "Timeline")}
            {link("/calendar", <CalendarDays size={16} />, "Calendar")}
            {link("/standups", <Megaphone size={16} />, "Standups")}
            {me.role === "admin" && link("/settings/integrations", <Plug size={16} />, "Integrations")}
            {me.role === "admin" && link("/settings/team", <Users size={16} />, "Team & workspace")}
            {link("/settings/profile", <Settings size={16} />, "Your settings")}
          </nav>
          <h2 className="mt-6 mb-1.5 px-2.5 font-sans text-[12px] font-medium tracking-normal text-rail-muted/80">Your projects</h2>
          <nav className="flex-1 space-y-0.5 overflow-y-auto" data-tour="projects-list">
            {projects.data?.map((p) => (
              <Link
                key={p.id}
                href={`/p/${p.key}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-rail-hover",
                  key === p.key ? "bg-rail-hover font-medium text-white" : "text-rail-muted hover:text-rail-ink",
                )}
              >
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-md font-mono text-[9px] font-bold text-white"
                  style={{ background: `oklch(0.52 0.11 ${[...p.key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)})` }}
                  aria-hidden
                >
                  {p.key.slice(0, 2)}
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[11px] tabular-nums text-rail-muted/80">{p.openIssues}</span>
              </Link>
            ))}
          </nav>
          <button
            onClick={() => startTour()}
            className="mt-3 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-rail-muted transition-colors hover:bg-rail-hover hover:text-rail-ink"
          >
            <GraduationCap size={16} />
            <span className="flex-1">Take the tour</span>
            {showTourDot && <span className="size-2 animate-pulse rounded-full bg-lime" aria-label="New" />}
          </button>
          <div className="mt-2 flex items-center gap-2 border-t border-rail-line px-1 pt-3">
            <Avatar name={me.name} image={me.image} />
            <span className="flex-1 truncate text-[13px] text-rail-ink">{me.name}</span>
            <Button
              variant="ghost"
              className="text-rail-muted hover:bg-rail-hover hover:text-rail-ink"
              size="sm"
              aria-label="Sign out"
              onClick={async () => {
                await authClient.signOut();
                location.href = "/sign-in";
              }}
            >
              <LogOut size={15} />
            </Button>
          </div>
        </aside>
        {nav && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setNav(false)} aria-hidden />}

        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-rail px-4 py-2 text-rail-ink md:hidden">
            <Button variant="ghost" size="sm" className="text-rail-ink hover:bg-rail-hover" aria-label="Open menu" onClick={() => setNav(true)}>
              <Menu size={18} />
            </Button>
            <Slice size={20} />
            <span className="font-[family-name:var(--font-display)] font-bold text-white">khira</span>
          </div>
          {children}
        </div>
      </div>

      <Tour open={tour.open} projectKey={tour.key} onClose={() => setTour({ open: false })} />
      <CreateIssueDialog open={create.open} defaultProjectId={create.projectId} onClose={() => setCreate({ open: false })} />
      <Palette open={palette} onClose={() => setPalette(false)} onCreate={() => openCreate()} onTour={startTour} projects={projects.data ?? []} />
    </ShellCtx.Provider>
  );
}

function Palette({ open, onClose, onCreate, onTour, projects }: { open: boolean; onClose: () => void; onCreate: () => void; onTour: () => void; projects: { key: string; name: string }[] }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  const results = useQuery({ ...trpc.issue.search.queryOptions({ q: debounced }), enabled: open && debounced.length > 0 });
  const matchingProjects = projects.filter((p) => !q || `${p.key} ${p.name}`.toLowerCase().includes(q.toLowerCase()));
  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      label="Command menu"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
    >
      <Command.Input
        value={q}
        onValueChange={setQ}
        placeholder="Search issues by key or text, or jump to a project…"
        className="w-full border-b border-line bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted"
      />
      <Command.List className="max-h-[50vh] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-muted">
        <Command.Empty className="px-3 py-6 text-center text-muted">{results.isFetching ? "Searching…" : "No issues match. Try a key like KHR-12."}</Command.Empty>
        {!!results.data?.length && (
          <Command.Group heading="Issues">
            {results.data.map((r) => (
              <Item key={r.id} value={r.key} onSelect={() => go(`/i/${r.key}`)}>
                <TypeIcon type={r.type} />
                <IssueKey k={r.key} />
                <span className="truncate">{r.title}</span>
              </Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Actions">
          <Item value="create" onSelect={() => (onClose(), onCreate())}>
            <Plus size={15} /> Create issue <span className="ml-auto"><Kbd>C</Kbd></span>
          </Item>
          <Item value="my-work" onSelect={() => go("/")}>
            <Inbox size={15} /> My work
          </Item>
          <Item value="inbox" onSelect={() => go("/inbox")}>
            <Bell size={15} /> Notifications
          </Item>
          <Item value="tour tutorial help" onSelect={() => (onClose(), onTour())}>
            <GraduationCap size={15} /> Take the tour
          </Item>
        </Command.Group>
        {matchingProjects.length > 0 && (
          <Command.Group heading="Projects">
            {matchingProjects.map((p) => (
              <Item key={p.key} value={`project-${p.key}`} onSelect={() => go(`/p/${p.key}`)}>
                <FolderKanban size={15} />
                <span className="font-mono text-[12px] text-muted">{p.key}</span> {p.name}
              </Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function Item(props: React.ComponentProps<typeof Command.Item>) {
  return <Command.Item {...props} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 data-[selected=true]:bg-accent-soft" />;
}
