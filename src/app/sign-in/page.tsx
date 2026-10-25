import { redirect } from "next/navigation";
import { getMember, socialProviders, ssoEnabled } from "@/server/auth";
import { SignInForm } from "./form";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ mode?: string; email?: string }> }) {
  if (await getMember()) redirect("/");
  const sp = await searchParams;
  // Invite emails link here with ?mode=signup&email=…
  return <SignInForm providers={socialProviders} sso={ssoEnabled} initialMode={sp.mode === "signup" ? "up" : "in"} initialEmail={sp.email?.slice(0, 200) ?? ""} />;
}
