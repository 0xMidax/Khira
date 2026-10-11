"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell";
import { Button, Input } from "@/components/ui";
import { useTRPC } from "@/trpc/react";

export default function Dashboards() {
  const trpc = useTRPC();
  const router = useRouter();
  const { me } = useShell();
  const list = useQuery(trpc.dashboard.list.queryOptions());
  const create = useMutation(trpc.dashboard.create.mutationOptions({ onSuccess: (d) => router.push(`/dashboards/${d.id}`) }));
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboards</h1>
      <ul className="mb-8 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface empty:hidden">
        {list.data?.map((d) => (
          <li key={d.id}>
            <Link href={`/dashboards/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken">
              <span className="flex-1 font-medium">{d.name}</span>
              <span className="text-[12px] text-muted">{d.ownerId === me.id ? (d.shared ? "Yours · shared" : "Yours") : "Shared"}</span>
            </Link>
          </li>
        ))}
      </ul>
      {me.role !== "guest" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name: String(new FormData(e.currentTarget).get("name")) });
          }}
        >
          <Input name="name" placeholder="Dashboard name, e.g. Team overview" required maxLength={80} className="w-72" aria-label="Dashboard name" />
          <Button variant="primary">Create dashboard</Button>
        </form>
      )}
    </main>
  );
}
