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
export declare function canInvite(role: MemberRole): boolean;
export declare function roleRank(role: MemberRole): number;
//# sourceMappingURL=roles.d.ts.map