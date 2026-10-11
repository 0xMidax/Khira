"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RichText } from "@/components/mention-textarea";
import { useShell } from "@/components/shell";
import { Avatar, Button, field, Input } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

export default function Standups() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const list = useQuery(trpc.standup.day.queryOptions({ day }));
  const mine = list.data?.find((s) => s.userId === me.id);
  const [text, setText] = useState("");
  useEffect(() => setText(mine?.content ?? ""), [mine?.content]);
  const save = useMutation(trpc.standup.save.mutationOptions({ onSuccess: () => (qc.invalidateQueries({ queryKey: trpc.standup.pathKey() }), toast.success("Standup saved")) }));
  // Slack mrkdwn bold (*x*) → Markdown bold for display.
  const md = (s: string) => s.replace(/(^|\s)\*([^*\n]+)\*/g, "$1**$2**").replace(/^• /gm, "- ");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Standups</h1>
          <p className="text-muted">Drafted every weekday morning from what each person worked on. Edit yours before it posts to Slack.</p>
        </div>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40" aria-label="Day" />
      </div>
      {me.role !== "guest" && (
        <section className="mb-8 rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-2 font-semibold">Yours{mine?.postedAt ? " (posted)" : ""}</h2>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={field} placeholder={"*Yesterday*\n• …\n*Today*\n• …\n*Blocked*\n• —"} aria-label="Your standup" />
          <Button variant="primary" size="sm" className="mt-2" disabled={!text.trim() || !!mine?.postedAt || save.isPending} onClick={() => save.mutate({ day, content: text })}>
            Save
          </Button>
        </section>
      )}
      <ul className="space-y-4">
        {list.data
          ?.filter((s) => s.userId !== me.id)
          .map((s) => (
            <li key={s.id} className="flex gap-3">
              <Avatar name={s.name} image={s.image} size={28} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <RichText body={md(s.content)} />
              </div>
            </li>
          ))}
      </ul>
      {list.data?.length === 0 && <p className="text-muted">No standups for this day yet.</p>}
    </main>
  );
}
