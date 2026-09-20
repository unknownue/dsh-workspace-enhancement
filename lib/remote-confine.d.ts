/**
 * REQ-I13 / ADR-0025: wrap `ctx.sandbox.confine` so a remote initiator cwd
 * does not get a *local* bwrap/landlock runner stuffed into argv.
 *
 * Official bash/fs escalation happens *before* confine. This passthrough only
 * skips host wrapping; it does not skip the approval card.
 *
 * @module dsh-workspace-enhancement/remote-confine
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConfinedArgv } from '@deepseek-ai/dsh-sandbox';
/** Identity confine result: the caller's argv, claimed as fully enforced. */
export declare function passthroughConfinedArgv(argv: readonly string[]): ConfinedArgv;
/**
 * True when the current initiator session's cwd is a remote route (`ssh://`
 * or a placeholder tree). Missing initiator → false (local is the safe default).
 */
export declare function shouldPassthroughRemoteConfine(ctx: Context): boolean;
/**
 * Install the remote-cwd confine short-circuit on the live `sandbox` service.
 * Safe to call when the name is not yet provided (`inject` waits).
 */
export declare function installRemoteConfinePassthrough(ctx: Context): void;
