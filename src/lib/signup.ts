/**
 * ALLOWED_SIGNUPS="acme.com,friend@gmail.com" — domains or exact emails.
 * The very first user may always sign up (bootstraps the admin).
 */
export function isSignupAllowed(email: string, allowList: string | undefined, isFirstUser: boolean) {
  if (isFirstUser) return true;
  const e = email.trim().toLowerCase();
  const domain = e.split("@")[1];
  return (allowList ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.includes("@") ? entry === e : entry === domain));
}
