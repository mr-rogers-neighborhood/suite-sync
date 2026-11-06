import { inviteIdSchema, workspaceIdSchema } from "./ids.js";
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
export const INVITE_SCHEME = "suite";
export const JOIN_HOST = "join";
export function formatInvite(details) {
    const query = new URLSearchParams({
        h: details.host,
        w: details.workspaceId,
        i: details.inviteId,
    });
    return `${INVITE_SCHEME}://${JOIN_HOST}?${query.toString()}`;
}
/**
 * Read one back.
 *
 * The reasons are written for the person holding the link, because the most likely failure
 * is a half-copied message and "that is not a join link" is the only useful thing to say.
 */
export function parseInvite(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return { ok: false, reason: "Paste a link first." };
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return { ok: false, reason: "That does not look like a link." };
    }
    if (url.protocol !== `${INVITE_SCHEME}:` || url.hostname !== JOIN_HOST) {
        return { ok: false, reason: "That link is not an invitation to a workspace." };
    }
    const host = url.searchParams.get("h") ?? "";
    if (!/^wss?:\/\/\S+$/u.test(host)) {
        return { ok: false, reason: "That invitation is missing the address to connect to." };
    }
    const workspaceId = url.searchParams.get("w") ?? "";
    if (!workspaceIdSchema.safeParse(workspaceId).success) {
        return { ok: false, reason: "That invitation is incomplete. Ask for a fresh one." };
    }
    const inviteId = url.searchParams.get("i") ?? "";
    if (!inviteIdSchema.safeParse(inviteId).success) {
        return { ok: false, reason: "That invitation is incomplete. Ask for a fresh one." };
    }
    return { ok: true, value: { host, workspaceId, inviteId } };
}
//# sourceMappingURL=inviteLink.js.map