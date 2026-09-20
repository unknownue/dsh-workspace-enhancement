/**
 * REQ-I5: subprocess handle that runs inside a core RPC session.
 *
 * Approval preflight still runs first (unwrapped argv). The fence's only job
 * for a fenced machine is `hub.require`; this handle then `spawn.start`s.
 *
 * @module dsh-workspace-enhancement/core-process
 */
import { Buffer } from 'node:buffer';
import { PassThrough } from 'node:stream';
import { CORE_EVENTS, CORE_METHODS, asRecord } from "./core-protocol.js";
import { SshOutputCollector } from "./output.js";
import { isCoreMissingError } from "./remote-policy.js";
function isCollect(mode) {
    return mode !== 'pipe' && mode !== 'inherit';
}
function pushChunk(collector, pipe, inherit, which, bytes) {
    collector?.push(bytes);
    if (pipe !== undefined)
        pipe.write(bytes);
    else if (inherit) {
        if (which === 'stdout')
            process.stdout.write(bytes);
        else
            process.stderr.write(bytes);
    }
}
export class CoreSubprocessHandle {
    hub;
    connectionId;
    cwd;
    spec;
    spillDir;
    preflight;
    policy;
    sshFallback;
    stdin;
    stdout;
    stderr;
    ownCollected;
    fallbackHandle;
    done;
    get collected() {
        return this.fallbackHandle?.collected ?? this.ownCollected;
    }
    stdoutCollector;
    stderrCollector;
    settled = false;
    job;
    unsub;
    /** BUG-9: a stop requested before the job id exists is remembered, not dropped. */
    terminatePending = false;
    terminateSentFor;
    terminateFailureValue;
    watchedClient;
    pendingStdin;
    constructor(hub, connectionId, cwd, spec, spillDir, preflight, policy = 'read-only', sshFallback) {
        this.hub = hub;
        this.connectionId = connectionId;
        this.cwd = cwd;
        this.spec = spec;
        this.spillDir = spillDir;
        this.preflight = preflight;
        this.policy = policy;
        this.sshFallback = sshFallback;
        const outMode = spec.stdio.stdout;
        const errMode = spec.stdio.stderr;
        this.stdout = outMode === 'pipe' ? new PassThrough() : undefined;
        this.stderr = errMode === 'pipe' ? new PassThrough() : undefined;
        this.stdoutCollector = isCollect(outMode)
            ? new SshOutputCollector(outMode.maxBytes, outMode.spill?.maxBytes, 'stdout', spillDir)
            : undefined;
        this.stderrCollector = isCollect(errMode)
            ? new SshOutputCollector(errMode.maxBytes, errMode.spill?.maxBytes, 'stderr', spillDir)
            : undefined;
        this.ownCollected = {
            ...(this.stdoutCollector !== undefined ? { stdout: this.stdoutCollector } : {}),
            ...(this.stderrCollector !== undefined ? { stderr: this.stderrCollector } : {}),
        };
        this.stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined;
        spec.signal?.addEventListener('abort', this.onAbort, { once: true });
        this.done = this.run();
        void this.done.catch(() => { });
        if (spec.signal?.aborted === true)
            this.terminate();
    }
    get pid() {
        return -1;
    }
    terminate() {
        if (this.fallbackHandle !== undefined) {
            this.fallbackHandle.terminate();
            return;
        }
        // BUG-9 startup window: `spawn.start` may not have answered yet (cold
        // core, approval gate, connection setup) — exactly when a cancel lands.
        // Remember it; trySendTerminate fires the moment the job id appears.
        this.terminatePending = true;
        this.trySendTerminate();
    }
    /** Last observed spawn.terminate delivery failure (test/telemetry surface, BUG-9). */
    get lastTerminateFailure() {
        return this.terminateFailureValue;
    }
    /**
     * Send `spawn.terminate` as soon as BOTH the request and the job id exist.
     * A missing core client or a failed RPC is recorded (not swallowed) and the
     * send is un-latched, so the next trigger retries instead of dying silently.
     */
    trySendTerminate() {
        if (!this.terminatePending || this.settled)
            return;
        const job = this.job;
        if (job === undefined || job === this.terminateSentFor)
            return;
        const client = this.hub.peek(this.connectionId, { cwd: this.cwd, policy: this.policy });
        if (client === undefined) {
            this.terminateFailureValue = new Error('core client unavailable for spawn.terminate');
            return;
        }
        this.terminateSentFor = job;
        void client.call(CORE_METHODS.spawnTerminate, { job }).then(undefined, (error) => {
            if (this.terminateSentFor === job)
                this.terminateSentFor = undefined;
            this.terminateFailureValue = error;
        });
    }
    waitForExit(signal) {
        if (this.settled)
            return Promise.resolve(true);
        if (signal?.aborted === true)
            return Promise.resolve(false);
        if (signal === undefined)
            return this.done.then(() => true, () => true);
        return new Promise((resolve) => {
            const onAbort = () => { cleanup(); resolve(false); };
            const cleanup = () => { signal.removeEventListener('abort', onAbort); };
            signal.addEventListener('abort', onAbort, { once: true });
            void this.done.then(() => { cleanup(); resolve(true); }, () => { cleanup(); resolve(true); });
        });
    }
    onAbort = () => { this.terminate(); };
    settle() {
        if (this.settled)
            return;
        this.settled = true;
        this.unsub?.();
        this.stdoutCollector?.seal();
        this.stderrCollector?.seal();
        this.spec.signal?.removeEventListener('abort', this.onAbort);
        if (this.stdout !== undefined)
            this.stdout.end();
        if (this.stderr !== undefined)
            this.stderr.end();
    }
    async run() {
        let releaseHold = () => { };
        try {
            if (this.preflight !== undefined)
                await this.preflight();
            const requireOpts = {
                cwd: this.cwd,
                policy: this.policy,
                ...(this.spec.signal !== undefined ? { signal: this.spec.signal } : {}),
            };
            const client = await this.hub.require(this.connectionId, requireOpts);
            releaseHold = this.hub.hold(this.connectionId, requireOpts);
            const exit = this.watch(client).finally(releaseHold);
            const started = asRecord(await client.call(CORE_METHODS.spawnStart, {
                argv: [...this.spec.argv],
                cwd: this.cwd,
                env: this.spec.env ?? {},
            }, this.spec.signal));
            const job = typeof started?.job === 'string' ? started.job : '';
            if (job === '')
                throw new Error('core spawn.start returned no job id');
            this.job = job;
            this.trySendTerminate();
            this.flushPendingStdin();
            return await exit;
        }
        catch (error) {
            releaseHold();
            if (this.sshFallback !== undefined && isCoreMissingError(error)) {
                this.fallbackHandle = this.sshFallback();
                const outcome = await this.fallbackHandle.done;
                this.settle();
                return outcome;
            }
            this.settle();
            throw error;
        }
    }
    watch(client) {
        return new Promise((resolve, reject) => {
            this.unsub = client.onEvent((method, params) => {
                // BUG-9: events can teach us the job id before spawn.start answers —
                // a pending terminate must ride the first event that names the job.
                const rec = asRecord(params);
                if (rec === undefined)
                    return;
                if (this.job === undefined && (method === CORE_EVENTS.spawnStdout || method === CORE_EVENTS.spawnStderr || method === CORE_EVENTS.spawnExit)) {
                    if (typeof rec.job === 'string')
                        this.job = rec.job;
                }
                this.trySendTerminate();
                this.flushPendingStdin();
                if (this.job !== undefined && rec.job !== this.job)
                    return;
                if (method === CORE_EVENTS.spawnStdout || method === CORE_EVENTS.spawnStderr) {
                    const bytes = Buffer.from(String(rec.b64 ?? ''), 'base64');
                    const which = method === CORE_EVENTS.spawnStdout ? 'stdout' : 'stderr';
                    const mode = which === 'stdout' ? this.spec.stdio.stdout : this.spec.stdio.stderr;
                    pushChunk(which === 'stdout' ? this.stdoutCollector : this.stderrCollector, which === 'stdout' ? this.stdout : this.stderr, mode === 'inherit', which, bytes);
                    return;
                }
                if (method === CORE_EVENTS.spawnExit) {
                    this.settle();
                    const code = typeof rec.exitCode === 'number' ? rec.exitCode : 0;
                    resolve({ exitCode: code, signal: null });
                }
            });
            if (this.stdin !== undefined) {
                this.stdin.on('data', (chunk) => {
                    const job = this.job;
                    if (job === undefined)
                        return;
                    const b64 = Buffer.from(chunk).toString('base64');
                    void client.call(CORE_METHODS.spawnStdin, { job, b64 }).catch(() => { });
                });
            }
            else if (typeof this.spec.stdio.stdin === 'object' && this.spec.stdio.stdin !== null && 'data' in this.spec.stdio.stdin) {
                // BUG-9: park the payload instead of spinning on queueMicrotask — a
                // slow spawn.start used to starve the whole event loop waiting for the
                // job id. flushPendingStdin sends it the moment the id lands.
                this.pendingStdin = Buffer.from(this.spec.stdio.stdin.data).toString('base64');
                this.watchedClient = client;
                this.flushPendingStdin();
            }
            void 0;
        });
    }
    /** Send the parked stdin payload once the job id exists (see watch()). */
    flushPendingStdin() {
        const b64 = this.pendingStdin;
        const job = this.job;
        const client = this.watchedClient;
        if (b64 === undefined || job === undefined || client === undefined)
            return;
        this.pendingStdin = undefined;
        void client.call(CORE_METHODS.spawnStdin, { job, b64 }).catch(() => { });
    }
}
//# sourceMappingURL=core-process.js.map