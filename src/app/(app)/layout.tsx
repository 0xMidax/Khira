import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { publicConfig } from "@/lib/public-config";
import { getSession } from "@/server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user.emailVerified || session.user.deactivatedAt) redirect("/sign-in");
  const { id, name, image, role } = session.user;
  return (
    <Shell me={{ id, name, image, role }} config={publicConfig()}>
      {children}
    </Shell>
  );
}
