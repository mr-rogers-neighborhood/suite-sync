import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { frameSchema, inviteRecordSchema, memberRoleSchema, roleRecordSchema, } from "@suite/sync";
export class MemoryHostStore {
    frames = new Map();
    invites = new Map();
    roles = new Map();
    keys = new Map();
    async loadFrames(workspaceId) {
        return [...(this.frames.get(workspaceId) ?? [])];
    }
    async appendFrame(workspaceId, frame) {
        const existing = this.frames.get(workspaceId) ?? [];
        existing.push(frame);
        this.frames.set(workspaceId, existing);
    }
    async loadRoles(workspaceId) {
        return [...(this.roles.get(workspaceId) ?? [])];
    }
    async appendRole(workspaceId, record) {
        const existing = this.roles.get(workspaceId) ?? [];
        existing.push(record);
        this.roles.set(workspaceId, existing);
    }
    async loadInvites(workspaceId) {
        return [...(this.invites.get(workspaceId) ?? [])];
    }
    async appendInvite(workspaceId, record) {
        const existing = this.invites.get(workspaceId) ?? [];
        existing.push(record);
        this.invites.set(workspaceId, existing);
    }
    async loadKeys(workspaceId) {
        return [...(this.keys.get(workspaceId) ?? [])];
    }
    async appendKey(workspaceId, key) {
        const existing = this.keys.get(workspaceId) ?? [];
        existing.push(key);
        this.keys.set(workspaceId, existing);
    }
    async compact(workspaceId, cutoff) {
        const kept = (this.frames.get(workspaceId) ?? []).filter((f) => f.receivedAt >= cutoff);
        this.frames.set(workspaceId, kept);
    }
}
/**
 * One append-only file per workspace, plus one for its roles.
 *
 * A crash mid-append can leave a partial line. That line is dropped on load rather than
 * failing the workspace: a torn write should cost one frame, not the room, because a frame
 * is only ever a message some device can still send again.
 */
export class FileHostStore {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    async loadFrames(workspaceId) {
        return readLines(this.framePath(workspaceId), (value) => frameSchema.safeParse(value).data);
    }
    async appendFrame(workspaceId, frame) {
        await this.appendLine(this.framePath(workspaceId), frame);
    }
    async loadRoles(workspaceId) {
        return readLines(this.rolePath(workspaceId), (value) => roleRecordSchema.safeParse(value).data);
    }
    async appendRole(workspaceId, record) {
        await this.appendLine(this.rolePath(workspaceId), record);
    }
    async loadInvites(workspaceId) {
        return readLines(this.invitePath(workspaceId), (value) => inviteRecordSchema.safeParse(value).data);
    }
    async appendInvite(workspaceId, record) {
        await this.appendLine(this.invitePath(workspaceId), record);
    }
    async loadKeys(workspaceId) {
        return readLines(this.keyPath(workspaceId), (value) => pinnedKey(value));
    }
    async appendKey(workspaceId, key) {
        await this.appendLine(this.keyPath(workspaceId), key);
    }
    async compact(workspaceId, cutoff) {
        const kept = (await this.loadFrames(workspaceId)).filter((f) => f.receivedAt >= cutoff);
        await mkdir(this.directory, { recursive: true });
        const target = this.framePath(workspaceId);
        const temporary = `${target}.tmp`;
        await writeFile(temporary, kept.map((frame) => `${JSON.stringify(frame)}\n`).join(""), "utf8");
        await rename(temporary, target);
    }
    async appendLine(path, value) {
        await mkdir(this.directory, { recursive: true });
        await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
    }
    framePath(workspaceId) {
        return join(this.directory, `${workspaceId}.frames.jsonl`);
    }
    rolePath(workspaceId) {
        return join(this.directory, `${workspaceId}.roles.jsonl`);
    }
    invitePath(workspaceId) {
        return join(this.directory, `${workspaceId}.invites.jsonl`);
    }
    keyPath(workspaceId) {
        return join(this.directory, `${workspaceId}.keys.jsonl`);
    }
}
async function readLines(path, parse) {
    let text;
    try {
        text = await readFile(path, "utf8");
    }
    catch (error) {
        if (isMissingFile(error))
            return [];
        throw error;
    }
    const values = [];
    for (const line of text.split("\n")) {
        if (line.trim().length === 0)
            continue;
        const parsed = parse(safeJson(line));
        if (parsed !== undefined)
            values.push(parsed);
    }
    return values;
}
function pinnedKey(value) {
    if (typeof value !== "object" || value === null)
        return undefined;
    const record = value;
    if (typeof record.deviceId !== "string" || typeof record.publicKey !== "string")
        return undefined;
    const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "a device";
    return {
        deviceId: record.deviceId,
        publicKey: record.publicKey,
        name,
        ...(invitedWith(record.invitedWith) ?? {}),
    };
}
/** The invitation a device spent, when the file still has one it can read. */
function invitedWith(value) {
    if (typeof value !== "object" || value === null)
        return undefined;
    const record = value;
    const role = memberRoleSchema.safeParse(record.role);
    if (typeof record.inviteId !== "string" || !role.success)
        return undefined;
    return { invitedWith: { inviteId: record.inviteId, role: role.data } };
}
function safeJson(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
function isMissingFile(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT");
}
//# sourceMappingURL=store.js.map