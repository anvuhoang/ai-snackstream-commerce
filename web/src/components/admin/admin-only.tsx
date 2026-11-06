"use client";

import { useAdmin } from "./admin-shell";

/** Show children only to a full admin. This is a convenience: the API enforces the rule regardless. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  return useAdmin().user.role === "admin" ? <>{children}</> : null;
}
