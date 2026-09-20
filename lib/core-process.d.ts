/**
 * REQ-I5: subprocess handle that runs inside a core RPC session.
 *
 * Approval preflight still runs first (unwrapped argv). The fence's only job
 * for a fenced machine is `hub.require`; this handle then `spawn.start`s.
 *
 * @module dsh-workspace-enhancement/core-process
 */
import type { Readable, Writable } from 'node:stream';
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import type { CoreHub } from './core-hub.ts';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { SshSubprocessHandle } from './process.ts';
export declare class CoreSubprocessHandle implements SubprocessHandle {
    private readonly hub;
    private readonly connectionId;
    private readonly cwd;
    private readonly spec;
    private readonly spillDir;
    private readonly preflight?;
    private readonly policy;
    private readonly sshFallback?;
    readonly stdin: Writable | undefined;
    readonly stdout: Readable | undefined;
    readonly stderr: Readable | undefined;
    private readonly ownCollected;
    private fallbackHandle;
    readonly done: Promise<SubprocessOutcome>;
    get collected(): SubprocessHandle['collected'];
    private readonly stdoutCollector;
    private readonly stderrCollector;
    private settled;
    private job;
    private unsub;
    /** BUG-9: a stop requested before the job id exists is remembered, not dropped. */
    private terminatePending;
    private terminateSentFor;
    private terminateFailureValue;
    private watchedClient;
    private pendingStdin;
    constructor(hub: CoreHub, connectionId: string, cwd: string, spec: SubprocessSpawnSpec, spillDir: string, preflight?: (() => Promise<void>) | undefined, policy?: SandboxMode, sshFallback?: (() => SshSubprocessHandle) | undefined);
    get pid(): number;
    terminate(): void;
    /** Last observed spawn.terminate delivery failure (test/telemetry surface, BUG-9). */
    get lastTerminateFailure(): unknown;
    /**
     * Send `spawn.terminate` as soon as BOTH the request and the job id exist.
     * A missing core client or a failed RPC is recorded (not swallowed) and the
     * send is un-latched, so the next trigger retries instead of dying silently.
     */
    private trySendTerminate;
    waitForExit(signal?: AbortSignal): Promise<boolean>;
    private readonly onAbort;
    private settle;
    private run;
    private watch;
    /** Send the parked stdin payload once the job id exists (see watch()). */
    private flushPendingStdin;
}
/** Type-only export kept so tests can construct a handle against a fake hub. */
export type { CoreHub };
