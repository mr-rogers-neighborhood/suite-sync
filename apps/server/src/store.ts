import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Frame, frameSchema } from "@suite/sync";

/**
 * Where a host's frames live between process lifetimes.
 *
 * The store never parses a payload. It writes one line per frame and reads them back,
 * which is the whole reason a file-backed store can sit under an encryption layer
 * without knowing anything about documents.
 *
 * Appending rather than rewriting is also what makes the retention rule honest: a host
 * may stop keeping old frames, and the only way that stays safe is if storing a frame
 * never required understanding one.
 */
export interface FrameStore {
  load(workspaceId: string): Promise<readonly Frame[]>;
  append(workspaceId: string, frame: Frame): Promise<void>;
}

export class MemoryFrameStore implements FrameStore {
  private readonly frames = new Map<string, Frame[]>();

  async load(workspaceId: string): Promise<readonly Frame[]> {
    return [...(this.frames.get(workspaceId) ?? [])];
  }

  async append(workspaceId: string, frame: Frame): Promise<void> {
    const existing = this.frames.get(workspaceId) ?? [];
    existing.push(frame);
    this.frames.set(workspaceId, existing);
  }
}

/**
 * One append-only file per workspace.
 *
 * A crash mid-append can leave a partial line. That line is dropped on load rather than
 * failing the workspace, because one torn write should cost one frame, not the room: a
 * frame is only ever a message some device can still send again.
 */
export class FileFrameStore implements FrameStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async load(workspaceId: string): Promise<readonly Frame[]> {
    let text: string;
    try {
      text = await readFile(this.pathFor(workspaceId), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const frames: Frame[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      const parsed = frameSchema.safeParse(safeJson(line));
      if (parsed.success) frames.push(parsed.data);
    }
    return frames;
  }

  async append(workspaceId: string, frame: Frame): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.pathFor(workspaceId), `${JSON.stringify(frame)}\n`, "utf8");
  }

  private pathFor(workspaceId: string): string {
    return join(this.directory, `${workspaceId}.frames.jsonl`);
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
