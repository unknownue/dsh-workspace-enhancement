/** One asynchronously-started SSH command projected onto the subprocess seam. */
import type { Readable, Writable } from 'node:stream';
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import type { SshTransport } from './transport.ts';
/**
 * SSH-backed subprocess handle. Remote pids stay on the remote: this handle
 * reports {@link SshSubprocessHandle.pid} as `-1` for the life of the call.
 */
export declare class SshSubprocessHandle implements SubprocessHandle {
    private readonly runtime;
    private readonly cwd;
    private readonly spec;
    private readonly spillDir;
    private readonly preflight?;
    private readonly resolveArgv?;
    readonly stdin: Writable | undefined;
    readonly stdout: Readable | undefined;
    readonly stderr: Readable | undefined;
    readonly collected: SubprocessHandle['collected'];
    readonly done: Promise<SubprocessOutcome>;
    /** Remote OS pids are not a local-process identity; the seam's sentinel. */
    readonly pid = -1;
    private readonly terminationController;
    private readonly stdoutCollector;
    private readonly stderrCollector;
    private channel;
    private graceTimer;
    private closeTimer;
    private settled;
    /**
     * Start the SSH command without blocking the synchronous spawn call.
     * @param runtime - connection owner backing this execution world.
     * @param cwd - resolved absolute remote working directory.
     * @param spec - fully resolved subprocess request.
     * @param spillDir - local spill directory for collect-mode streams.
     * @param preflight - optional AUDIT-6 approval gate, awaited at the HEAD of
     * the async startup (connection and command text are resolved, nothing has
     * reached SSH yet); a rejection fails `done` without touching the network.
     * @param resolveArgv - optional second startup stage (REQ-I9 / ADR-0022 §2.2):
     * awaited AFTER `preflight` and BEFORE the command serialization, it returns
     * the argv to actually execute. Defaults to identity, so an unmodified
     * deployment behaves exactly as before. The fence lives here — and nowhere
     * upstream of the gate — because the approval gate must keep inspecting the
     * UNWRAPPED argv (a `bwrap` `argv[0]` would stop `isRemoteShellShape()`
     * matching and silently disarm AUDIT-6 for every remote command).
     */
    constructor(runtime: SshTransport, cwd: string, spec: SubprocessSpawnSpec, spillDir: string, preflight?: (() => Promise<void>) | undefined, resolveArgv?: ((argv: readonly string[]) => Promise<readonly string[]>) | undefined);
    /** @inheritdoc */
    terminate(): void;
    /** @inheritdoc */
    waitForExit(signal?: AbortSignal): Promise<boolean>;
    private readonly onAbort;
    private fireSignal;
    /**
     * BUG-9 termination chain: EOF on the steward's stop wire (stdin), then the
     * SSH signal request (OpenSSH ≥ 7.9), then a local close so `done` cannot
     * hang the tool call on a server that ignores both.
     */
    private beginTermination;
    private settle;
    private run;
    private wireStdout;
    private wireStderr;
}
