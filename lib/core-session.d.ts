/**
 * REQ-I5 / ADR-0024 §6: identity of a *running* `dsh-core serve`.
 *
 * Disk artifact and SSH keepalive are other layers. This module only answers
 * "which jail process should this call reuse?" — POSIX prefix math, no SSH.
 *
 * @module dsh-workspace-enhancement/core-session
 */
import type { CoreServeSandbox } from './remote-policy.ts';
export type { CoreServeSandbox } from './remote-policy.ts';
/** Kill an idle serve this many ms after the last RPC, when no spawn job is held. */
export declare const CORE_IDLE_MS: number;
/**
 * Absolute POSIX directory (or file) used as a jail root / containment probe.
 * Relative, drive-letter, and empty spellings are not roots.
 */
export declare function normalizePosixRoot(value: string | undefined): string | undefined;
/** POSIX prefix containment — same rule as `posixInside` in `core/serve.go`. */
export declare function posixInside(root: string, path: string): boolean;
/** Longest declared root that contains `path`, or `undefined`. */
export declare function longestContainingRoot(roots: readonly string[], path: string): string | undefined;
/** Deduped absolute POSIX roots, first-seen order. */
export declare function uniquePosixRoots(values: readonly (string | undefined)[]): string[];
/**
 * Official git tools pass `GIT_DIR` (`.git` or `…/.git/HEAD`) as cwd. That
 * path is often missing on a fresh remote tree; bwrap `--bind` then dies with
 * `Can't find source path …/.git`. The writable jail is the working tree.
 */
export declare function gitWorkingTreeOf(path: string): string;
/** Cache key for one serve process. `read-only` and `off` ignore workspace. */
export declare function coreSessionKey(connectionId: string, mode: CoreServeSandbox, workspace?: string): string;
export interface CoreWorkspaceInput {
    mode: CoreServeSandbox;
    machineWorkspace?: string | undefined;
    machineCwd?: string | undefined;
    /**
     * Session / spawn cwd. May mint a sibling workspace-write jail when nothing
     * already-declared contains it.
     */
    cwd?: string | undefined;
    /**
     * Operation path (fs target, browse listing). Never mints a new jail by
     * itself — only matches an already-declared root.
     */
    path?: string | undefined;
    /** Roots remembered for this machine until SSH dispose / hub.close. */
    knownRoots?: readonly string[] | undefined;
}
/**
 * Jail `--workspace` for a workspace-write call. `read-only` and `off`
 * return `undefined` (one process per machine; `off` skips bwrap).
 */
export declare function resolveCoreWorkspace(input: CoreWorkspaceInput): string | undefined;
