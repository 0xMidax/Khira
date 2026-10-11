import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { getSession } from "@/server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user.emailVerified) redirect("/sign-in");
  const { id, name, image, role } = session.user;
  return <Shell me={{ id, name, image, role }}>{children}</Shell>;
}
