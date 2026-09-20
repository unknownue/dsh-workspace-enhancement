/**
 * BUG-7: one FsVersion algorithm for the SFTP face and the remote core.
 *
 * A read on one transport followed by a CAS write on the other used to
 * mismatch because SFTP hashed `[path, size, Date, mode]` with an `ssh:`
 * prefix while the core hashed basename + hex(RFC3339Nano) + two size
 * bytes. Both now hash the same JSON tuple:
 *
 *   [posixPath, size, mtimeMs quantized to whole seconds]
 *
 * SFTP attrs only carry second-resolution mtime, so the millisecond field
 * is quantized; otherwise a core stat (UnixMilli) and an SFTP stat of the
 * same second would still disagree. Mode is not part of the tuple: a chmod
 * must not trip a content CAS.
 *
 * @module dsh-workspace-enhancement/fs-version
 */
/** Whole-second mtime expressed as milliseconds, so SFTP and core agree. */
export declare function versionMtimeMs(mtimeMs: number): number;
/**
 * Best-effort milliseconds from an ssh2 `Stats`/`Attributes` or a Node
 * `fs.Stats`. ssh2 SFTP attrs store Unix seconds; Node stats store `mtimeMs`.
 */
export declare function statsVersionMtimeMs(stats: {
    mtimeMs?: number;
    mtime?: number | Date;
}): number;
/**
 * Opaque content-version token. Identical for the same path/size/mtime on
 * every transport. The path is POSIX-slash so a Windows host talking to a
 * Linux core still matches.
 */
export declare function fileContentVersion(path: string, size: number, mtimeMs: number): string;
