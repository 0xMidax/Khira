// Khira's role from the Authentik `groups` claim. null = no Khira group: refuse the sign-in, so access
// fails closed even if Authentik's own policy binding is missing or wrong.
export function khiraRole(groups: unknown): "admin" | "member" | null {
  const g = Array.isArray(groups) ? groups : [];
  if (g.includes("khira-admin")) return "admin";
  if (g.includes("khira-member")) return "member";
  return null;
}

// Role decided while reading the profile, handed to the user-create hook of the same sign-in.
// Keyed by lower-case email; read once.
export const pendingRoles = new Map<string, "admin" | "member">();
