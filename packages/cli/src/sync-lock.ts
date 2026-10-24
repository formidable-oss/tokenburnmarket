import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * A lock older than this is stale whatever its PID says. No sync runs this
 * long: collection stops after five minutes and every upload after one. After
 * a crash or a reboot the PID can belong to another process, which would
 * otherwise hold the lock forever.
 */
export const MAX_LOCK_AGE_MS = 6 * 60 * 60 * 1000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function tooOld(entry: string, now: number): boolean {
  try {
    return now - statSync(entry).mtimeMs > MAX_LOCK_AGE_MS;
  } catch (error) {
    // Released while we looked: the next attempt finds the directory free.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function removeOwner(path: string, owner: string): void {
  try {
    unlinkSync(join(path, owner));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    rmdirSync(path);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

/**
 * Publish a populated directory atomically, so every held lock has a unique
 * owner entry. Stale contenders remove only that entry; rmdir cannot remove a
 * replacement owner's nonempty directory. An owner is stale when its process
 * is gone or its entry is older than `MAX_LOCK_AGE_MS`.
 */
export function acquireSyncLock(
  path: string,
  pid = process.pid,
  alive: (pid: number) => boolean = isAlive,
  now: () => number = Date.now,
): { release: () => void } | null {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const candidate = mkdtempSync(`${path}.candidate-`);
  const owner = `${pid}-${randomUUID()}`;
  try {
    writeFileSync(join(candidate, owner), "", { mode: 0o600 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        renameSync(candidate, path);
        let released = false;
        return { release: () => {
          if (released) return;
          released = true;
          removeOwner(path, owner);
        } };
      } catch (error) {
        if (!["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
      let entries: string[];
      try {
        entries = readdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (entries.length === 0) continue; // Atomic rename can replace an empty stale directory.
      if (entries.length !== 1) return null;
      const staleOwner = entries[0]!;
      const match = /^(\d+)-[0-9a-f-]+$/.exec(staleOwner);
      if (!match || Number(match[1]) < 1) return null;
      if (alive(Number(match[1])) && !tooOld(join(path, staleOwner), now())) return null;
      removeOwner(path, staleOwner);
    }
    return null;
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
}
