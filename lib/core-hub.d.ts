/**
 * REQ-I5 / ADR-0024: live `dsh-core serve` cache.
 *
 * Key is `(machineId, confinementMode, workspaceRoot?)` — not "one process
 * per SSH connection". `off` (session danger-full-access) is one unjailed
 * serve per machine. A dead session is fail-closed for confined **writes and
 * spawn**; REQ-I15 lets confined **reads** fall back to SFTP. danger may fall
 * back to SFTP via {@link CoreMissingError}.
 *
 * @module dsh-workspace-enhancement/core-hub
 */
import type { Context } from '@deepseek-ai/cordis';
import { CoreClient } from './core-client.ts';
import { CORE_REMOTE_HOME } from './core-protocol.ts';
import { CORE_IDLE_MS } from './core-session.ts';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { RemoteSandboxDeps } from './remote-sandbox-fence.ts';
import type { CoreServeSandbox } from './remote-policy.ts';
import type { RemoteSandboxMode } from './remote-sandbox.ts';
import type { SshTransport } from './transport.ts';
export interface CoreStatusView {
    ok: boolean;
    version?: string | undefined;
    arch?: string | undefined;
    proto?: number | undefined;
    caps?: readonly string[] | undefined;
    sandbox?: RemoteSandboxMode | undefined;
    detail?: string | undefined;
}
export interface CoreOpenRequest {
    connectionId: string;
    mode: CoreServeSandbox;
    workspace?: string | undefined;
    signal?: AbortSignal | undefined;
    transport: SshTransport;
}
export type CoreSessionOpener = (request: CoreOpenRequest) => Promise<CoreClient>;
export interface CoreRequireOpts {
    /** Session / spawn cwd — may mint a sibling workspace-write jail. */
    cwd?: string | undefined;
    /** Operation path (fs target, browse listing) — match only, never mint. */
    path?: string | undefined;
    signal?: AbortSignal | undefined;
    /** Session `/permission` (or escalation overlay). Absent → resolve from ctx. */
    policy?: SandboxMode | undefined;
}
export interface CoreHub {
    modeOf(connectionId: string | undefined): RemoteSandboxMode;
    require(connectionId: string, opts?: CoreRequireOpts): Promise<CoreClient>;
    peek(connectionId: string, opts?: CoreRequireOpts): CoreClient | undefined;
    /** Keep the matching serve off the idle timer until the disposer runs (spawn jobs). */
    hold(connectionId: string, opts?: CoreRequireOpts): () => void;
    status(connectionId: string, signal?: AbortSignal): Promise<CoreStatusView>;
    close(connectionId: string): void;
}
/** Shell command that execs the installed core in the login user's home. */
export declare function coreServeCommand(mode: CoreServeSandbox, workspace?: string): string;
export declare function coreVersionCommand(): string;
export declare function coreArtifactName(): string;
/**
 * Build the hub. Tests inject `open` (a fake client); production uses SSH exec.
 * `idleMs: 0` disables idle-kill (unit tests that would otherwise pin the event loop).
 */
export declare function createCoreHub(ctx: Context, options?: {
    deps?: RemoteSandboxDeps;
    open?: CoreSessionOpener;
    statusOf?: (connectionId: string, signal?: AbortSignal) => Promise<CoreStatusView>;
    idleMs?: number;
}): CoreHub;
export declare function coreUnavailable(detail: string): never;
/**
 * Return the process-wide hub when the plugin fiber has provided it.
 * Callers that must not create a service (picker tests, tool stubs) use this.
 */
export declare function coreHubOf(ctx: Context): CoreHub | undefined;
/**
 * Return the process-wide hub, creating and `ctx.provide`-ing it on first use
 * so the aggregate row, the web channel, and the directory picker share one
 * session cache. Effect-bound: unloading the row drops the name.
 */
export declare function ensureCoreHub(ctx: Context): CoreHub;
export { CORE_REMOTE_HOME, CORE_IDLE_MS };
