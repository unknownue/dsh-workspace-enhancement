/**
 * REQ-I5 / ADR-0024: framed JSON protocol for the remote core.
 *
 * Pure codec + constants. No SSH, no filesystem, no Go — so the plugin and
 * the fake in-process core share one encoder, and tests can pin golden frames
 * without a live binary.
 *
 * Frame layout: 4-byte big-endian length + UTF-8 JSON. Unknown JSON keys are
 * ignored by construction (we only read named fields). Unknown methods are a
 * server concern (`UNIMPLEMENTED`).
 *
 * @module dsh-workspace-enhancement/core-protocol
 */
export declare const CORE_PROTO = 1;
/** Single-frame payload cap (bytes of JSON, not including the length prefix). */
export declare const CORE_MAX_FRAME: number;
/**
 * Artifact / hello version. Keep in lockstep with `core/artifact.json`.
 *
 * Single source of truth is `core/artifact.json`; `src/core-artifact.ts` is
 * generated from it by `npm run sync:core-manifest`, and `npm run check:static`
 * fails when that projection is stale (INFRA-15 drift guard). The Go const
 * `coreArtifactVersion` in `core/protocol.go` must match (hello / `dsh-core
 * version`). Re-exported here so every consumer keeps importing it from the
 * protocol module.
 */
export { CORE_ARTIFACT_ARCH, CORE_ARTIFACT_VERSION } from './core-artifact.ts';
/** v1 capability names advertised by `hello`. */
export declare const CORE_CAPS: readonly ["fs", "spawn", "rg"];
export type CoreCap = (typeof CORE_CAPS)[number];
export declare const CORE_ERROR_UNIMPLEMENTED = "UNIMPLEMENTED";
export declare const CORE_ERROR_SANDBOX = "SANDBOX_UNAVAILABLE";
export declare const CORE_ERROR_BAD_REQUEST = "BAD_REQUEST";
export declare const CORE_ERROR_IO = "EIO";
export declare const CORE_ERROR_NOT_FOUND = "ENOENT";
export declare const CORE_ERROR_PERMISSION = "EACCES";
export declare const CORE_ERROR_READ_ONLY = "EROFS";
export declare const CORE_ERROR_EXISTS = "EEXIST";
export declare const CORE_ERROR_NOT_DIR = "ENOTDIR";
export declare const CORE_ERROR_IS_DIR = "EISDIR";
/** Remote install prefix (login-user writable, no root). */
export declare const CORE_REMOTE_HOME = "~/.dsh-core";
export declare const CORE_METHODS: {
    readonly hello: "hello";
    readonly fsRealpath: "fs.realpath";
    readonly fsStat: "fs.stat";
    readonly fsLstat: "fs.lstat";
    readonly fsRead: "fs.read";
    readonly fsReadRange: "fs.readRange";
    readonly fsListDir: "fs.listDir";
    readonly fsWrite: "fs.write";
    readonly fsMkdir: "fs.mkdir";
    readonly spawnStart: "spawn.start";
    readonly spawnStdin: "spawn.stdin";
    readonly spawnTerminate: "spawn.terminate";
};
export declare const CORE_EVENTS: {
    readonly spawnStdout: "spawn.stdout";
    readonly spawnStderr: "spawn.stderr";
    readonly spawnExit: "spawn.exit";
};
/** One protocol message (request, response, or event). Extra JSON keys tolerated. */
export interface CoreMessage {
    proto: number;
    id: number;
    m?: string;
    p?: unknown;
    ok?: unknown;
    err?: CoreErrorBody;
}
export interface CoreErrorBody {
    code: string;
    message: string;
}
export interface CoreHelloOk {
    proto: number;
    version: string;
    arch: string;
    caps: readonly string[];
    sandbox: 'read-only' | 'workspace-write' | 'off';
}
export interface CoreStatOk {
    type: 'file' | 'directory' | 'symlink' | 'other';
    size?: number;
    mode: number;
    mtimeMs: number;
    /** Opaque version token the host echoes back on write/edit. */
    version: string;
}
export interface CoreListEntry {
    name: string;
    type: CoreStatOk['type'];
    size?: number;
    version: string;
}
/**
 * Encode one message as a length-prefixed frame.
 * @param message - protocol object; `proto` is filled with {@link CORE_PROTO} when omitted.
 */
export declare function encodeFrame(message: Omit<CoreMessage, 'proto'> & {
    proto?: number;
}): Buffer;
/**
 * Pull complete frames off a buffer. Incomplete trailing bytes stay in `rest`.
 * A declared length above {@link CORE_MAX_FRAME} throws (fail closed: the
 * stream is hostile or corrupt).
 */
export declare function decodeFrames(buffer: Buffer): {
    messages: CoreMessage[];
    rest: Buffer<ArrayBufferLike>;
};
/** Structural parse: missing `id`/`proto` become 0 so a junk frame is still typed. */
export declare function asCoreMessage(value: unknown): CoreMessage;
/** Whether this capability set covers one method (hello is always allowed). */
export declare function methodAllowed(method: string, caps: readonly string[]): boolean;
/** Record shape guard used by callers that received `ok`. */
export declare function asRecord(value: unknown): Record<string, unknown> | undefined;
