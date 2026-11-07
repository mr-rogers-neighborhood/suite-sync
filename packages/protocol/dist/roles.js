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
/**
 * Whether a device is in this workspace at all, whatever it may do.
 *
 * The distinction matters for exactly one message: presence. A reader that nobody can see
 * would make "collaboration" mean "collaboration between editors", so a viewer's cursor is
 * forwarded while its frames are still refused.
 */
export function hasRole(role) {
    return role !== null && role !== undefined;
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