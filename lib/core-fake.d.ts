/**
 * REQ-I5: in-process core server used by tests. Speaks the same framed JSON
 * as the Go binary, against a local directory tree that stands in for the
 * remote filesystem. Spawn is simulated (no real child) unless `liveSpawn`
 * is set — agent sandboxes cannot pipe-spawn.
 *
 * @module dsh-workspace-enhancement/core-fake
 */
import type { Readable, Writable } from 'node:stream';
export interface FakeCoreOptions {
    /** Host directory that maps onto POSIX `/`. */
    root: string;
    sandbox: 'read-only' | 'workspace-write' | 'off';
    /** Absolute POSIX path bound writable in workspace-write (optional). */
    workspace?: string;
    /** Capability set advertised by hello (default: all v1 caps). */
    caps?: readonly string[];
}
/**
 * Serve the core protocol on a duplex until stdin ends.
 */
export declare function serveFakeCore(stdin: Readable, stdout: Writable, options: FakeCoreOptions): void;
/** Wipe a fake-core root (tests). */
export declare function resetFakeRoot(root: string): void;
