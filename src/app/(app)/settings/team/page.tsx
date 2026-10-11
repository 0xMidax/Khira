"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useShell } from "@/components/shell";
import { Avatar, Button, Input, Select } from "@/components/ui";
import { ROLES } from "@/lib/validators";
import { useTRPC } from "@/trpc/react";

const ROLE_HELP = { admin: "Everything, plus team and project settings", member: "Create and edit issues and projects", guest: "Read-only" };

export default function Team() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useShell();
  const users = useQuery({ ...trpc.user.list.queryOptions({ includeDeactivated: true }), enabled: me.role === "admin" });
  const invites = useQuery({ ...trpc.invite.list.queryOptions(), enabled: me.role === "admin" });
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.user.pathKey() }).then(() => qc.invalidateQueries({ queryKey: trpc.invite.pathKey() }));
  const setRole = useMutation(trpc.user.setRole.mutationOptions({ onSuccess: () => (refresh(), toast.success("Role updated")) }));
  const invite = useMutation(
    trpc.invite.create.mutationOptions({
      onSuccess: (r) => {
        refresh();
        if (r.emailed) toast.success("Invite sent");
        else toast("Couldn’t email the invite. Share this link instead.", { action: { label: "Copy link", onClick: () => navigator.clipboard.writeText(r.link) } });
      },
    }),
  );
  const revoke = useMutation(trpc.invite.revoke.mutationOptions({ onSuccess: refresh }));
  const deactivate = useMutation(
    trpc.user.deactivate.mutationOptions({ onSuccess: (r) => (refresh(), toast.success(`Deactivated${r.unassigned ? `; ${r.unassigned} open issues unassigned` : ""}`)) }),
  );
  const reactivate = useMutation(trpc.user.reactivate.mutationOptions({ onSuccess: () => (refresh(), toast.success("Reactivated")) }));
  if (me.role !== "admin") return <p className="p-8 text-muted">Only admins can manage the team.</p>;
  const active = users.data?.filter((u) => !u.deactivatedAt) ?? [];
  const gone = users.data?.filter((u) => u.deactivatedAt) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <h1 className="mb-1 page-title">Team</h1>
      <p className="mb-6 text-muted">Invite people by email. They get a link to create their account with the role you choose.</p>

      <form
        className="mb-6 flex flex-wrap gap-2 rounded-lg border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          invite.mutate({ email: String(f.get("email")), role: f.get("role") as (typeof ROLES)[number] }, { onSuccess: () => e.currentTarget?.reset() });
        }}
      >
        <Input name="email" type="email" required placeholder="name@company.com" className="min-w-56 flex-1" aria-label="Email to invite" />
        <Select name="role" defaultValue="member" className="w-36" aria-label="Role">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={invite.isPending}>
          Send invite
        </Button>
      </form>

      {!!invites.data?.length && (
        <section className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold text-muted">Pending invites</h2>
          <ul className="divide-y divide-line overflow-hidden card">
            {invites.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium">{i.email}</span>
                <span className="text-muted capitalize">{i.role}</span>
                <span className="text-muted">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                <Button size="sm" onClick={() => invite.mutate({ email: i.email, role: i.role })}>
                  Resend
                </Button>
                <Button size="sm" variant="danger" onClick={() => revoke.mutate({ id: i.id })}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="divide-y divide-line overflow-hidden card">
        {active.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={u.name} image={u.image} size={28} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-medium">
                {u.name}
                {u.twoFactorEnabled && <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">2FA</span>}
              </span>
              <span className="block truncate text-[13px] text-muted">{u.email}</span>
            </span>
            <Select value={u.role} onChange={(e) => setRole.mutate({ userId: u.id, role: e.target.value as (typeof ROLES)[number] })} className="w-auto" aria-label={`Role for ${u.name}`} title={ROLE_HELP[u.role]}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)} · {ROLE_HELP[r]}
                </option>
              ))}
            </Select>
            {u.id !== me.id && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (!confirm(`Deactivate ${u.name}? They’ll be signed out everywhere and can’t sign in. Their history stays.`)) return;
                  deactivate.mutate({ userId: u.id, unassign: confirm("Also unassign their open issues?") });
                }}
              >
                Deactivate
              </Button>
            )}
          </li>
        ))}
      </ul>

      {gone.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold text-muted">Deactivated</h2>
          <ul className="divide-y divide-line overflow-hidden card">
            {gone.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-muted">
                <Avatar name={u.name} image={u.image} size={22} />
                <span className="flex-1 truncate">
                  {u.name} · {u.email}
                </span>
                <Button size="sm" onClick={() => reactivate.mutate({ userId: u.id })}>
                  Reactivate
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Workspace />
    </main>
  );
}

function Workspace() {
  return (
    <section className="mt-10">
      <h2 className="mb-1 font-semibold">Backup</h2>
      <p className="mb-3 text-[13px] text-muted">Download everything (projects, issues, comments, history) as JSON. A copy is also saved to storage every night when the backup job runs.</p>
      <a href="/api/export?full=1" className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 font-medium hover:bg-sunken">
        Download backup
      </a>
    </section>
  );
}
