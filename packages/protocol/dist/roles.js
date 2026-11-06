import { z } from "zod";
/**
 * The three roles the server enforces.
 *
 * `owner` is the workspace creator in v1: ownership transfer is deliberately
 * out of scope until the membership log has a two-owner story. `editor` writes,
 * `viewer` reads and receives live updates.
 */
export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export function canWrite(role) {
    return role !== "viewer";
}
export function canInvite(role) {
    return role === "owner";
}
export function roleRank(role) {
    switch (role) {
        case "viewer":
            return 0;
        case "editor":
            return 1;
        case "owner":
            return 2;
    }
}
//# sourceMappingURL=roles.js.map