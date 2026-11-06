import { z } from "zod";
export declare const workspaceIdSchema: z.ZodString;
export declare const deviceIdSchema: z.ZodString;
export declare const memberIdSchema: z.ZodString;
export declare const inviteIdSchema: z.ZodString;
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type DeviceId = z.infer<typeof deviceIdSchema>;
export type MemberId = z.infer<typeof memberIdSchema>;
export type InviteId = z.infer<typeof inviteIdSchema>;
export declare function isWorkspaceId(value: unknown): value is WorkspaceId;
export declare function isDeviceId(value: unknown): value is DeviceId;
export declare function isMemberId(value: unknown): value is MemberId;
export declare function isInviteId(value: unknown): value is InviteId;
//# sourceMappingURL=ids.d.ts.map