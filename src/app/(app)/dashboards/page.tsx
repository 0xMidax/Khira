"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Lock, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useShell } from "@/components/shell";
import { Button, EmptyState, Input } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

export default function Dashboards() {
  const trpc = useTRPC();
  const router = useRouter();
  const { me } = useShell();
  const list = useQuery(trpc.dashboard.list.queryOptions());
  const create = useMutation(
    trpc.dashboard.create.mutationOptions({ onSuccess: (d) => router.push(`/dashboards/${d.id}`), onError: (e) => toast.error(e.message) }),
  );
  const canCreate = me.role !== "guest";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="page-title">Dashboards</h1>
          <p className="mt-1 text-muted">Live views of your work across every project, built from saved queries.</p>
        </div>
        {canCreate && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name: String(new FormData(e.currentTarget).get("name")) });
            }}
          >
            <Input name="name" placeholder="New dashboard name" required maxLength={80} className="w-60" aria-label="Dashboard name" />
            <Button variant="primary" disabled={create.isPending}>
              <Plus size={15} /> Create dashboard
            </Button>
          </form>
        )}
      </div>

      {list.data?.length === 0 && (
        <EmptyState title="No dashboards yet">{canCreate ? "Create one above. It starts with useful widgets you can change or remove." : "When teammates share a dashboard, it shows up here."}</EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((d) => (
          <li key={d.id}>
            <Link href={`/dashboards/${d.id}`} className="card group flex h-full flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
              <span className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
                  <LayoutDashboard size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold group-hover:text-accent">{d.name}</span>
                  <span className="text-[12px] text-muted">{d.ownerId === me.id ? "Yours" : `By ${d.ownerName}`}</span>
                </span>
              </span>
              <span className="mt-auto flex items-center gap-3 text-[12px] text-muted">
                <span>
                  {d.widgetCount} widget{d.widgetCount === 1 ? "" : "s"}
                </span>
                <span className="flex items-center gap-1">
                  {d.shared ? <Users size={12} /> : <Lock size={12} />}
                  {d.shared ? "Shared with the team" : "Only you"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
