"use client";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTRPC } from "@/trpc/react";
import { Avatar, cn, field } from "./ui";

/** Textarea that turns `@na…` into `@[Name](id)` via a small picker. */
export function MentionTextarea({
  value,
  onChange,
  className,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const trpc = useTRPC();
  const users = useQuery(trpc.user.list.queryOptions());
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  const matches = query ? (users.data ?? []).filter((u) => u.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6) : [];

  function sync(v: string, caret: number) {
    const m = /(^|\s)@([\w.-]{0,30})$/.exec(v.slice(0, caret));
    setQuery(m ? { start: caret - m[2].length - 1, text: m[2] } : null);
    setActive(0);
  }

  function pick(u: { id: string; name: string }) {
    if (!query || !ref.current) return;
    const caret = ref.current.selectionStart;
    const token = `@[${u.name.replace(/[\]\[]/g, "")}](${u.id}) `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + token.length;
      ref.current?.setSelectionRange(pos, pos);
      ref.current?.focus();
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        className={cn(field, "resize-y leading-relaxed", className)}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setQuery(null);
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        {...rest}
      />
      {matches.length > 0 && (
        <ul role="listbox" className="absolute left-2 z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          {matches.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(u);
              }}
              className={cn("flex cursor-pointer items-center gap-2 px-2.5 py-1.5", i === active && "bg-accent-soft")}
            >
              <Avatar name={u.name} image={u.image} size={18} />
              {u.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Markdown (GFM) with @mention chips. Raw HTML is never rendered. */
export function RichText({ body }: { body: string }) {
  const md = body.replace(/@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)/g, (_, name: string) => `[@${name}](#mention)`);
  return (
    <div className="prose-khira break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href === "#mention" ? (
              <span className="rounded bg-accent-soft px-1 font-medium text-accent">{children}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
                {children}
              </a>
            ),
          // eslint-disable-next-line @next/next/no-img-element -- only our own uploaded files; external images (tracking pixels) are dropped
          img: ({ src, alt }) => (typeof src === "string" && src.startsWith("/api/files/") ? <img src={src} alt={alt ?? ""} className="max-h-96 rounded-md" /> : <span>{alt}</span>),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
