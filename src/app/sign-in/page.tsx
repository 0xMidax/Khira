import { redirect } from "next/navigation";
import { getSession, socialProviders } from "@/server/auth";
import { SignInForm } from "./form";

export default async function SignInPage() {
  if ((await getSession())?.user.emailVerified) redirect("/");
  return <SignInForm providers={socialProviders} />;
}
