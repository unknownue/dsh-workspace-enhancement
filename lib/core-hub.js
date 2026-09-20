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
import { CoreClient } from "./core-client.js";
import { CORE_ARTIFACT_ARCH, CORE_ARTIFACT_VERSION, CORE_CAPS, CORE_ERROR_SANDBOX, CORE_PROTO, CORE_REMOTE_HOME, } from "./core-protocol.js";
import { CoreRpcError } from "./core-client.js";
import { CORE_IDLE_MS, coreSessionKey, resolveCoreWorkspace, uniquePosixRoots, } from "./core-session.js";
import { parseSshRoute } from "./registry.js";
import { quoteShellArg, startExec } from "./ssh-core.js";
import { remoteRouteFromCwd } from "./transport.js";
import { effectiveModeOf, remoteSandboxDepsOf, remoteSandboxUnavailable, } from "./remote-sandbox-fence.js";
import { CoreMissingError, coreServeSandboxOf, initiatorSessionOf, isConfinedSandboxMode, resolveRemoteSessionMode, } from "./remote-policy.js";
import { REMOTE_SANDBOX_MESSAGES, RemoteSandboxError, } from "./remote-sandbox.js";
/** Shell command that execs the installed core in the login user's home. */
export function coreServeCommand(mode, workspace) {
    const bin = '"$HOME"/.dsh-core/current/dsh-core';
    const parts = [bin, 'serve', '--sandbox', quoteShellArg(mode)];
    if (mode !== 'off' && workspace !== undefined && workspace !== '') {
        parts.push('--workspace', quoteShellArg(workspace));
    }
    return parts.join(' ');
}
export function coreVersionCommand() {
    return '"$HOME"/.dsh-core/current/dsh-core version';
}
export function coreArtifactName() {
    return `dsh-core-${CORE_ARTIFACT_VERSION}-${CORE_ARTIFACT_ARCH}.tar.gz`;
}
async function openOverSsh(request) {
    const client = await request.transport.getClient(request.signal);
    const command = coreServeCommand(request.mode, request.workspace);
    const stderrChunks = [];
    const channel = await startExec(client, command, {
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
        onStderr: (chunk) => { stderrChunks.push(chunk); },
    });
    return new CoreClient(channel, channel, {
        stderrOf: () => Buffer.concat(stderrChunks).toString('utf8'),
    });
}
function sideRootsOf(ctx, connectionId) {
    if (typeof ctx.get !== 'function')
        return [];
    const store = ctx.get('sideWorkspaces', false);
    if (store === undefined || typeof store.list !== 'function')
        return [];
    const out = [];
    for (const item of store.list()) {
        if (item.kind !== 'remote')
            continue;
        const route = parseSshRoute(item.rootKey);
        if (route === null || route.id !== connectionId)
            continue;
        out.push(route.path);
    }
    return uniquePosixRoots(out);
}
/**
 * Build the hub. Tests inject `open` (a fake client); production uses SSH exec.
 * `idleMs: 0` disables idle-kill (unit tests that would otherwise pin the event loop).
 */
export function createCoreHub(ctx, options = {}) {
    const deps = options.deps ?? remoteSandboxDepsOf(ctx);
    const open = options.open ?? openOverSsh;
    const idleMs = options.idleMs ?? CORE_IDLE_MS;
    const live = new Map();
    const known = new Map();
    const opening = new Map();
    /** Confined open failures (missing binary/cap). Cleared by close/deploy. */
    const blocked = new Map();
    const modeOf = (connectionId) => effectiveModeOf(deps, connectionId);
    const remember = (connectionId, workspace) => {
        if (workspace === undefined || workspace === '/')
            return;
        let set = known.get(connectionId);
        if (set === undefined) {
            set = new Set();
            known.set(connectionId, set);
        }
        set.add(workspace);
    };
    const clearBlocked = (connectionId) => {
        const prefix = `${connectionId}\0`;
        for (const key of [...blocked.keys()]) {
            if (key.startsWith(prefix))
                blocked.delete(key);
        }
    };
    const knownRootsOf = (connectionId) => {
        const machine = deps.machine(connectionId);
        const initiator = remoteRouteFromCwd(initiatorSessionOf(ctx)?.header?.cwd);
        return uniquePosixRoots([
            machine?.workspace,
            machine?.cwd,
            initiator?.connectionId === connectionId ? initiator.path : undefined,
            ...sideRootsOf(ctx, connectionId),
            ...(known.get(connectionId) ?? []),
        ]);
    };
    const policyOf = (opts) => opts?.policy ?? resolveRemoteSessionMode(ctx);
    const workspaceOf = (connectionId, serve, opts) => {
        const machine = deps.machine(connectionId);
        const posixOf = (value) => remoteRouteFromCwd(value)?.path ?? value;
        return resolveCoreWorkspace({
            mode: serve,
            machineWorkspace: machine?.workspace,
            machineCwd: machine?.cwd,
            cwd: posixOf(opts?.cwd),
            path: posixOf(opts?.path),
            knownRoots: knownRootsOf(connectionId),
        });
    };
    const keyOf = (connectionId, opts) => {
        const serve = coreServeSandboxOf(policyOf(opts));
        return coreSessionKey(connectionId, serve, workspaceOf(connectionId, serve, opts));
    };
    const clearIdle = (session) => {
        if (session.idle === undefined)
            return;
        clearTimeout(session.idle);
        session.idle = undefined;
    };
    const drop = (session, kill) => {
        if (live.get(session.key) !== session)
            return;
        live.delete(session.key);
        clearIdle(session);
        session.unsubActivity();
        session.unsubClose();
        if (kill)
            session.client.close();
    };
    const scheduleIdle = (session) => {
        clearIdle(session);
        if (idleMs <= 0 || session.busy > 0 || live.get(session.key) !== session)
            return;
        session.idle = setTimeout(() => { drop(session, true); }, idleMs);
        if (typeof session.idle === 'object' && session.idle !== null && typeof session.idle.unref === 'function') {
            session.idle.unref();
        }
    };
    const attach = (session) => {
        session.unsubActivity = session.client.onActivity(() => { scheduleIdle(session); });
        session.unsubClose = session.client.onClose(() => { drop(session, false); });
        scheduleIdle(session);
    };
    const requireSession = async (connectionId, opts) => {
        const policy = policyOf(opts);
        const serve = coreServeSandboxOf(policy);
        const confined = isConfinedSandboxMode(policy);
        const workspace = workspaceOf(connectionId, serve, opts);
        const key = coreSessionKey(connectionId, serve, workspace);
        const existing = live.get(key);
        if (existing !== undefined) {
            scheduleIdle(existing);
            return existing.client;
        }
        const cached = blocked.get(key);
        if (cached !== undefined)
            throw cached;
        const pending = opening.get(key);
        if (pending !== undefined)
            return pending;
        const attempt = (async () => {
            const connection = deps.connection(connectionId);
            const machine = deps.machine(connectionId);
            const refuseMode = serve === 'off' ? 'read-only' : serve;
            if (connection === undefined || machine === undefined) {
                throw remoteSandboxUnavailable(refuseMode, `machine ${JSON.stringify(connectionId)} is not usable`);
            }
            if (serve === 'workspace-write' && (workspace === undefined || workspace === '' || workspace === '/')) {
                throw remoteSandboxUnavailable(refuseMode, REMOTE_SANDBOX_MESSAGES.workspaceRootRequired);
            }
            let client;
            try {
                client = await open({
                    connectionId,
                    mode: serve,
                    transport: connection,
                    ...(workspace !== undefined ? { workspace } : {}),
                    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
                });
                // Hello is the serve's birth certificate (ADR-0024). Do not tie it to
                // the first tool's AbortSignal — that signal aborting used to kill the
                // channel (`core stdout closed`) and fail the whole turn.
                const hello = await client.hello();
                if (hello.proto !== CORE_PROTO) {
                    throw remoteSandboxUnavailable(refuseMode, `core proto ${String(hello.proto)} is not ${CORE_PROTO}`);
                }
                for (const cap of CORE_CAPS) {
                    if (!hello.caps.includes(cap)) {
                        throw remoteSandboxUnavailable(refuseMode, `core is missing cap ${cap}`);
                    }
                }
            }
            catch (error) {
                client?.close();
                if (error instanceof RemoteSandboxError) {
                    if (confined)
                        blocked.set(key, error);
                    throw error;
                }
                const detail = error instanceof Error ? error.message : String(error);
                if (!confined)
                    throw new CoreMissingError(detail);
                const refusal = remoteSandboxUnavailable(refuseMode, detail);
                blocked.set(key, refusal);
                throw refusal;
            }
            if (client === undefined) {
                throw remoteSandboxUnavailable(refuseMode, 'core session opened without a client');
            }
            remember(connectionId, workspace);
            blocked.delete(key);
            const session = {
                key,
                connectionId,
                workspace,
                client,
                busy: 0,
                idle: undefined,
                unsubClose: () => { },
                unsubActivity: () => { },
            };
            live.set(key, session);
            attach(session);
            return client;
        })().finally(() => { opening.delete(key); });
        opening.set(key, attempt);
        return attempt;
    };
    const peek = (connectionId, opts) => {
        if (opts !== undefined) {
            return live.get(keyOf(connectionId, opts))?.client;
        }
        for (const session of live.values()) {
            if (session.connectionId === connectionId)
                return session.client;
        }
        return undefined;
    };
    const hold = (connectionId, opts) => {
        const session = live.get(keyOf(connectionId, opts));
        if (session === undefined)
            return () => { };
        session.busy += 1;
        clearIdle(session);
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            session.busy = Math.max(0, session.busy - 1);
            scheduleIdle(session);
        };
    };
    const close = (connectionId) => {
        for (const session of [...live.values()]) {
            if (session.connectionId === connectionId)
                drop(session, true);
        }
        known.delete(connectionId);
        clearBlocked(connectionId);
    };
    if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
            for (const session of [...live.values()])
                drop(session, true);
            known.clear();
            blocked.clear();
        }, 'dsw core hub sessions');
    }
    return {
        modeOf,
        require: requireSession,
        peek,
        hold,
        status: async (connectionId, signal) => {
            if (options.statusOf !== undefined)
                return options.statusOf(connectionId, signal);
            const connection = deps.connection(connectionId);
            if (connection === undefined)
                return { ok: false, detail: 'unknown machine' };
            // BUG-6: answer from the ON-DISK artifact, never from a running serve. A
            // cached `dsh-core serve` outlives the directory it was exec'd from, so
            // asking it made the panel report "installed" after the operator deleted
            // `~/.dsh-core/<version>/` — until the idle kill. One exec cannot lie.
            const sessionLive = peek(connectionId) !== undefined;
            try {
                const outcome = await connection.exec(coreVersionCommand(), signal !== undefined ? { signal } : undefined);
                if (outcome.exitCode !== 0) {
                    const detail = (outcome.stderr || outcome.stdout || 'core not installed').trim();
                    return {
                        ok: false,
                        detail: sessionLive
                            ? `${detail} (a cached core session is still running; it exits on idle)`
                            : detail,
                    };
                }
                const parsed = JSON.parse(outcome.stdout);
                return {
                    ok: true,
                    version: parsed.version ?? CORE_ARTIFACT_VERSION,
                    arch: parsed.arch,
                    proto: parsed.proto,
                    caps: parsed.caps,
                    sandbox: modeOf(connectionId),
                };
            }
            catch (error) {
                return { ok: false, detail: error instanceof Error ? error.message : String(error) };
            }
        },
        close,
    };
}
export function coreUnavailable(detail) {
    throw new CoreRpcError({ code: CORE_ERROR_SANDBOX, message: detail });
}
/**
 * Return the process-wide hub when the plugin fiber has provided it.
 * Callers that must not create a service (picker tests, tool stubs) use this.
 */
export function coreHubOf(ctx) {
    if (typeof ctx.get !== 'function')
        return undefined;
    return ctx.get('coreHub', false);
}
/**
 * Return the process-wide hub, creating and `ctx.provide`-ing it on first use
 * so the aggregate row, the web channel, and the directory picker share one
 * session cache. Effect-bound: unloading the row drops the name.
 */
export function ensureCoreHub(ctx) {
    const existing = coreHubOf(ctx);
    if (existing !== undefined)
        return existing;
    const hub = createCoreHub(ctx);
    if (typeof ctx.provide !== 'function')
        return hub;
    try {
        ctx.provide('coreHub', hub);
    }
    catch {
        const raced = coreHubOf(ctx);
        if (raced !== undefined)
            return raced;
        throw new Error('dsw: coreHub service is already owned by another fiber');
    }
    return hub;
}
export { CORE_REMOTE_HOME, CORE_IDLE_MS };
//# sourceMappingURL=core-hub.js.map