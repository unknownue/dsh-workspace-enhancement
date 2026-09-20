/**
 * REQ-I5: FileSystemBranch backed by a core RPC session.
 * editText stays host-side (read + patch + fs.write).
 *
 * @module dsh-workspace-enhancement/core-fs
 */
import type { Context } from '@deepseek-ai/cordis';
import { FsVersion } from '@deepseek-ai/dsh-fs';
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import { CoreClient } from './core-client.ts';
import type { CoreHub } from './core-hub.ts';
import { SshFileSystemEngine } from './filesystem.ts';
import type { FileSystemBranch } from './mixed.ts';
/**
 * Official Write resolves a path before the file exists. Local dsh-fs-local
 * realpaths the nearest existing ancestor; deployed cores that still
 * EvalSymlinks the leaf need the same walk on this side.
 */
export declare function realpathAllowMissing(lookup: (path: string, signal?: AbortSignal) => Promise<string>, path: string, signal?: AbortSignal): Promise<string>;
export declare class CoreFileSystem implements FileSystemBranch {
    private readonly ctx;
    private readonly client;
    private readonly mode;
    private readonly locks;
    constructor(ctx: Context, client: CoreClient, mode?: SandboxMode);
    processPathFromHostPath(_hostPath: string): string | undefined;
    processPath(target: FsTarget): string;
    fileUrl(target: FsTarget): string;
    contains(parent: FsTarget, child: FsTarget): boolean;
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    readByteRange(target: FsTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome>;
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: ReturnType<typeof FsVersion>;
    }, signal?: AbortSignal): Promise<FsEditOutcome>;
    private writeUnlocked;
    private withLock;
}
/**
 * Remote-world filesystem: core RPC when a Linux core is up.
 * REQ-I15: confined + missing core → **reads** fall back to SFTP (so host
 * project-root probes and official Read still work); writes stay fail-closed.
 * danger-full-access with no core stays today's SFTP for every face.
 */
export declare class CoreRoutingFileSystem implements FileSystemBranch {
    private readonly ctx;
    private readonly sftp;
    private readonly hub;
    constructor(ctx: Context, sftp: SshFileSystemEngine, hub: CoreHub);
    processPathFromHostPath(_hostPath: string): string | undefined;
    private delegate;
    private idOfTarget;
    private pathOf;
    private targetOpts;
    processPath(target: FsTarget): string;
    fileUrl(target: FsTarget): string;
    contains(parent: FsTarget, child: FsTarget): boolean;
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    readByteRange(target: FsTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsWriteOutcome>;
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: ReturnType<typeof FsVersion>;
    }, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsEditOutcome>;
}
