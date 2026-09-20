/**
 * REQ-I13 / ADR-0025: session `/permission` → core `--sandbox`, and the
 * transport fallback when a Linux core is missing.
 *
 * Machine `remoteSandbox` is not consulted here. The effective mode is the
 * per-call `sandboxPolicy` (escalation overlay) or `ctx.sandboxPolicy.resolve()`.
 *
 * @module dsh-workspace-enhancement/remote-policy
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
/** `dsh-core serve --sandbox` tokens, including unjailed `off`. */
export type CoreServeSandbox = 'off' | 'read-only' | 'workspace-write';
/** Thrown when danger-full-access may fall back to SFTP/SSH because no core opened. */
export declare const CORE_MISSING = "CORE_MISSING";
export declare class CoreMissingError extends Error {
    readonly code = "CORE_MISSING";
    constructor(detail: string);
}
export declare function isCoreMissingError(error: unknown): boolean;
export declare function isSandboxMode(raw: unknown): raw is SandboxMode;
/** Confined session modes fail closed when the core is missing. */
export declare function isConfinedSandboxMode(mode: SandboxMode): boolean;
/** One remote `ctx.fs` call is either a read face or a mutating write face (REQ-I15). */
export type RemoteFsFace = 'read' | 'write';
/** Fence / core refusals carry `SANDBOX_UNAVAILABLE` (RemoteSandboxError, CoreRpcError). */
export declare function isSandboxUnavailableError(error: unknown): boolean;
/**
 * REQ-I15: when the Linux core cannot open, which fs face may use SFTP.
 *
 * - danger-full-access: every face, on {@link CoreMissingError} (today's SFTP).
 * - confined: **reads only**, and only on `SANDBOX_UNAVAILABLE`. Writes stay
 *   fail-closed so a missing bwrap/core cannot silently mutate the remote.
 */
export declare function sftpFallbackForCoreGap(mode: SandboxMode, face: RemoteFsFace, error: unknown): boolean;
/** Local `danger-full-access` is remote `--sandbox off` (same RPC, no bwrap). */
export declare function coreServeSandboxOf(mode: SandboxMode): CoreServeSandbox;
/**
 * Pull `mode` off a `SandboxExecutionPolicy` object, a bare mode string, or
 * `undefined`.
 */
export declare function sandboxModeFromPolicy(policy: unknown): SandboxMode | undefined;
/** Calling session of the current agent initiator, when one exists. */
export declare function initiatorSessionOf(ctx: Context): {
    header?: {
        cwd?: string;
    };
} | undefined;
/**
 * Effective sandbox mode for one remote capability call.
 *
 * Order: explicit per-call policy (escalation overlay) → `ctx.sandboxPolicy`
 * with the initiator session → fail-safe `read-only` (confined, so a missing
 * core refuses writes/spawn instead of opening SFTP; REQ-I15 still lets reads
 * degrade).
 */
export declare function resolveRemoteSessionMode(ctx: Context, explicit?: unknown): SandboxMode;
