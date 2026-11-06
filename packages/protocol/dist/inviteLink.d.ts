/**
 * The thing one person sends another.
 *
 * A URL rather than an opaque blob: it survives chat clients that mangle punctuation, it
 * can be clicked if anything ever knows how to handle it, and a person can look at it and
 * see it is a join link rather than a password.
 *
 * It carries three facts and no secrets. The invite id is a bearer token — whoever holds the
 * link can ask to join — which is why it expires and why it works once.
 */
export declare const INVITE_SCHEME = "suite";
export declare const JOIN_HOST = "join";
export interface InviteDetails {
    /** The address of the machine that is carrying the workspace, as `ws://host:port/sync`. */
    readonly host: string;
    readonly workspaceId: string;
    readonly inviteId: string;
}
export type InviteParse = {
    readonly ok: true;
    readonly value: InviteDetails;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function formatInvite(details: InviteDetails): string;
/**
 * Read one back.
 *
 * The reasons are written for the person holding the link, because the most likely failure
 * is a half-copied message and "that is not a join link" is the only useful thing to say.
 */
export declare function parseInvite(text: string): InviteParse;
//# sourceMappingURL=inviteLink.d.ts.map