import { z } from "zod";
/**
 * The three roles the server enforces.
 *
 * `owner` is the workspace creator in v1: ownership transfer is deliberately
 * out of scope until the membership log has a two-owner story. `editor` writes,
 * `viewer` reads and receives live updates.
 */
export declare const memberRoleSchema: z.ZodEnum<{
    owner: "owner";
    editor: "editor";
    viewer: "viewer";
}>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export declare function canWrite(role: MemberRole): boolean;
/**
 * Whether a device is in this workspace at all, whatever it may do.
 *
 * The distinction matters for exactly one message: presence. A reader that nobody can see
 * would make "collaboration" mean "collaboration between editors", so a viewer's cursor is
 * forwarded while its frames are still refused.
 */
export declare function hasRole(role: MemberRole | null | undefined): boolean;
export declare function canInvite(role: MemberRole): boolean;
export declare function roleRank(role: MemberRole): number;
//# sourceMappingURL=roles.d.ts.map