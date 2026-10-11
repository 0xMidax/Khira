"use client";
import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { IssueDetail } from "./issue-detail";
import { IssueKey } from "./ui";

/** Opens an issue in the modal on top of whatever page you're on (?issue=KEY), so Back closes it. */
export function useOpenIssue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("issue", key);
    else next.delete("issue");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
}

export function IssueModal() {
  const openKey = useSearchParams().get("issue");
  const open = useOpenIssue();
  const panel = useRef<HTMLDivElement>(null);

  // Any plain click on a link to /i/KEY opens the modal instead; ⌘/Ctrl/middle-click still opens a new tab.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // On a full issue page, links just navigate (two live issue views would both grab shortcuts).
      if (location.pathname.startsWith("/i/") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.("a[href^='/i/']");
      if (!a || a.hasAttribute("data-full-page") || a.getAttribute("target")) return;
      const m = /^\/i\/([A-Za-z0-9]+-\d+)$/.exec(a.getAttribute("href")!);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      open(m[1].toUpperCase());
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  });

  useEffect(() => {
    if (!openKey) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && open(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!openKey) return null;
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[oklch(0.2_0.02_160/0.45)] p-2 backdrop-blur-[2px] sm:p-6 lg:p-10" onMouseDown={(e) => e.target === e.currentTarget && open(null)}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={openKey} className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl outline-none">
        <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
          <IssueKey k={openKey} />
          <span className="flex-1" />
          <Link href={`/i/${openKey}`} data-full-page className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted hover:bg-sunken hover:text-ink">
            <Maximize2 size={14} /> Open full page
          </Link>
          <button onClick={() => open(null)} className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <IssueDetail key={openKey} issueKey={openKey} onDeleted={() => open(null)} />
      </div>
    </div>
  );
}
