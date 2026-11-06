import { z } from "zod";

/**
 * The three roles the server enforces.
 *
 * `owner` is the workspace creator in v1: ownership transfer is deliberately
 * out of scope until the membership log has a two-owner story. `editor` writes,
 * `viewer` reads and receives live updates.
 */
export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);

export type MemberRole = z.infer<typeof memberRoleSchema>;

export function canWrite(role: MemberRole): boolean {
  return role !== "viewer";
}

export function canInvite(role: MemberRole): boolean {
  return role === "owner";
}

export function roleRank(role: MemberRole): number {
  switch (role) {
    case "viewer":
      return 0;
    case "editor":
      return 1;
    case "owner":
      return 2;
  }
}
