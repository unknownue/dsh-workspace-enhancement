/**
 * Shared SSH connection mechanics for dsh-workspace-enhancement.
 *
 * One copy of the ProxyJump-chain open, host-key verification, exec channel
 * collection, remote-environment read (with cache), SFTP caching, and shell
 * quoting helpers that the aggregate `ctx.ssh` runtime and the registry-owned
 * `SshConnection` both need. The connection-world contracts (`SshTransport`,
 * `ExecOutcome`, `JumpConfig`, `SshConnectionSpec`) are unchanged; this module
 * only removes the duplicated implementations of `runtime.ts` and
 * `connection.ts`, which are thin shells around {@link SshSession} now.
 * @module dsh-workspace-enhancement/ssh-core
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix } from 'node:path';
import { Client } from 'ssh2';
/**
 * Quote one argument for a POSIX login shell: single quotes with the only
 * escaping a single-quoted string needs. Identical in spirit to the E2B
 * adapter's helper so both remote providers share one quoting rule.
 * @param value - exact argument value to preserve.
 * @returns a single shell word with no interpolation.
 */
export function quoteShellArg(value) {
    return `'${value.replaceAll('\'', '\'"\'"\'')}'`;
}
/**
 * Wrap a remote command so it runs from the configured working directory.
 * @param cwd - absolute remote working directory.
 * @param command - the remote command to run there.
 * @returns the `cd`-guarded command text.
 */
export function wrapCwd(cwd, command) {
    return `cd -- ${quoteShellArg(cwd)} && ${command}`;
}
/** OpenSSH's default identity probe order, used when no auth is configured. */
const DEFAULT_IDENTITY_FILES = ['.ssh/id_ed25519', '.ssh/id_ecdsa', '.ssh/id_rsa'];
/**
 * The first existing OpenSSH default identity, mirroring the ssh client's own
 * probe: a hop with no password, key, or agent configured would otherwise be
 * rejected by every server because ssh2 never tries default key files.
 */
export function defaultIdentity() {
    for (const candidate of DEFAULT_IDENTITY_FILES) {
        const expanded = join(homedir(), candidate);
        if (existsSync(expanded))
            return readFileSync(expanded, 'utf8');
    }
    return undefined;
}
/**
 * Reads an identity value that is either PEM content or a local identity-file
 * path. A missing file must not leak its local path into a user-facing message
 * — the raw ENOENT text is replaced by a sanitized one here because the
 * `ctx.ssh` construction path (resolveHost/resolveJump) has no connect-rewrap
 * layer to clean it. The error object is kept (code/name preserved).
 */
export function resolvePrivateKey(value) {
    if (value.includes('-----BEGIN'))
        return value;
    try {
        return readFileSync(value, 'utf8');
    }
    catch (error) {
        if (error instanceof Error)
            error.message = 'dsw: cannot read private key: <redacted>';
        throw error;
    }
}
/**
 * Build the host-key verifier for strict checking: accept only a key whose
 * SHA256 fingerprint or raw base64 encoding matches a known-hosts entry.
 * @param knownHosts - configured trusted fingerprints or keys.
 * @returns a verifier accepting exactly the matching keys.
 */
export function hostVerifierFor(knownHosts) {
    return (key) => {
        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`;
        const raw = key.toString('base64');
        return knownHosts.some((entry) => {
            // A known_hosts line is "<host> <keytype> <token>"; the token is the field that varies.
            const token = entry.trim().split(/\s+/).at(-1) ?? '';
            return token === fingerprint || token === raw;
        });
    };
}
/**
 * Shape the ssh2 connection config for one hop, without the jump socket.
 * Host-key verification and the default-identity probe apply per hop, so a
 * jump chain is verified at every boundary it crosses. A caller-supplied
 * per-hop verifier (TOFU) wins over the static known-hosts list; `strict`
 * falls back to {@link hostVerifierFor} otherwise.
 */
export function toConnectConfig(host, strict, knownHosts, hostVerifier) {
    const config = {
        host: host.host,
        port: host.port,
        username: host.username,
        readyTimeout: host.readyTimeout,
        keepaliveInterval: host.keepaliveInterval,
        keepaliveCountMax: host.keepaliveCountMax,
    };
    if (host.password !== undefined)
        config.password = host.password;
    if (host.privateKey !== undefined)
        config.privateKey = host.privateKey;
    if (host.passphrase !== undefined)
        config.passphrase = host.passphrase;
    if (host.agent !== undefined)
        config.agent = host.agent;
    if (hostVerifier !== undefined) {
        const hop = host;
        config.hostVerifier = (key) => hostVerifier(hop, key);
    }
    else if (strict) {
        config.hostVerifier = hostVerifierFor(knownHosts);
    }
    if (config.password === undefined && config.privateKey === undefined && config.agent === undefined) {
        const identity = defaultIdentity();
        if (identity !== undefined)
            config.privateKey = identity;
    }
    return config;
}
/** Resolve once the client reaches its ready state. */
export function connectReady(client, config) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const onReady = () => {
            if (settled)
                return;
            settled = true;
            resolve();
        };
        const onError = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        };
        // Keep an error listener mounted after settle: ssh2 emits twice on a failed
        // connect — a socket error first, then `close` → its onDone re-emits
        // "Connection lost before handshake" via the protocol level. Removing the
        // listener on the first error turns that second emit into an unhandled
        // 'error' event which crashes the whole host process (observed: dsh web
        // died ~1 min after boot when a remote probe hit a mid-handshake reset).
        // After settle the listener only guards that escape; it never rejects an
        // already-settled promise. The caller tears the client down on failure
        // (openChain ends the partial chain), after which ssh2 emits no more errors.
        client.once('ready', onReady);
        client.on('error', onError);
        client.connect(config);
    });
}
/** Open a direct-tcpip channel through one already-connected hop. */
export function forwardThrough(client, host, port) {
    return new Promise((resolve, reject) => {
        client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
            if (error !== undefined)
                reject(error);
            else
                resolve(channel);
        });
    });
}
/**
 * Open the whole jump chain: each hop connects after the previous one, and the
 * last client is the target. On failure the already-opened clients are ended
 * (the original error owns the failure) and it is rethrown.
 * @param hostVerifier - optional per-hop verifier (TOFU); wins over strict.
 * @param onClient - optional callback run with each client immediately after
 * construction, BEFORE its connect attempt — the seam where a session owner
 * attaches lifecycle listeners so no window exists in which an emitted
 * `'error'` would be unobserved (an unobserved ssh2 `'error'` crashes the
 * host process).
 * @returns the opened clients, target last.
 */
export async function openChain(hosts, strict, knownHosts, hostVerifier, onClient) {
    const clients = [];
    try {
        for (let index = 0; index < hosts.length; index += 1) {
            const host = hosts[index];
            const previous = clients[index - 1];
            const client = new Client();
            onClient?.(client);
            clients.push(client);
            const config = toConnectConfig(host, strict, knownHosts, hostVerifier);
            if (previous === undefined) {
                await connectReady(client, config);
            }
            else {
                const socket = await forwardThrough(previous, host.host, host.port);
                await connectReady(client, { ...config, sock: socket });
            }
        }
        return clients;
    }
    catch (error) {
        for (const client of clients.reverse()) {
            try {
                client.end();
            }
            catch (_alreadyEnded) {
                // Best-effort teardown of the partial chain; the original error owns the failure.
            }
        }
        throw error;
    }
}
/**
 * ssh2 throws this exact message synchronously from `exec`/`shell`/`sftp`
 * when the client's socket is gone (closed by the peer, NAT, or network
 * loss) — the stale cached connection signature the callers retry on.
 * @param error - the thrown value to classify.
 * @returns whether the error marks a dead cached socket.
 */
export function isStaleSocketError(error) {
    return error instanceof Error && error.message === 'Not connected';
}
/**
 * Run one control-plane command on an authenticated client with collected
 * output. Used by adapters for executable lookup, canonical-path resolution,
 * and the remote-environment probe, not for user work.
 * @param client - the authenticated target client.
 * @param text - remote command text (already shell-quoted by the caller).
 * @param opts - optional cancellation.
 * @returns the collected exit facts and output.
 */
export function execChannel(client, text, opts) {
    return new Promise((resolve, reject) => {
        // Buffer whole chunks and decode once: SSH data events may split a
        // multi-byte UTF-8 character across two callbacks, so per-chunk
        // decoding would corrupt it.
        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;
        let channel;
        const finish = (exitCode, signal) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve({
                exitCode,
                signal,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
            });
        };
        const onAbort = () => {
            // Closing the channel ends the remote command; its close event reports the outcome.
            channel?.close();
        };
        const cleanup = () => { opts?.signal?.removeEventListener('abort', onAbort); };
        client.exec(text, { pty: false }, (error, stream) => {
            if (error !== undefined) {
                cleanup();
                reject(error);
                return;
            }
            channel = stream;
            stream.on('data', (data) => { stdoutChunks.push(data); });
            stream.stderr.on('data', (data) => { stderrChunks.push(data); });
            stream.on('close', (code, signal) => { finish(code, signal); });
        });
        if (opts?.signal?.aborted === true) {
            onAbort();
            return;
        }
        opts?.signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/**
 * Open a long-lived remote exec whose stdout is NOT collected into a string.
 * The framed core RPC (REQ-I5) lives on this duplex; {@link execChannel}
 * would swallow the protocol bytes.
 */
export function startExec(client, text, opts) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let channel;
        const onAbort = () => { channel?.close(); };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            opts?.signal?.removeEventListener('abort', onAbort);
            reject(error);
        };
        client.exec(text, { pty: false }, (error, stream) => {
            if (error !== undefined) {
                fail(error);
                return;
            }
            channel = stream;
            // Always drain stderr: unread stderr is a known ssh2 stall, and jail
            // failures (`dsh-core: jail: …`) are written here, not stdout.
            stream.stderr.on('data', (chunk) => { opts?.onStderr?.(chunk); });
            if (settled) {
                stream.close();
                return;
            }
            if (opts?.signal?.aborted === true) {
                stream.close();
                const reason = opts.signal.reason;
                fail(reason instanceof Error ? reason : new Error('aborted'));
                return;
            }
            settled = true;
            // The serve outlives one tool call (ADR-0024 idle 10 min). Do not close
            // the channel when the opener's AbortSignal later fires.
            opts?.signal?.removeEventListener('abort', onAbort);
            resolve(stream);
        });
        if (opts?.signal?.aborted === true) {
            const reason = opts.signal.reason;
            fail(reason instanceof Error ? reason : new Error('aborted'));
            return;
        }
        opts?.signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/** Parse the NUL-delimited name/value stream produced by a remote `env -0`. */
export function parseRemoteEnvironment(stdout) {
    const environment = {};
    for (const entry of stdout.split('\0')) {
        if (entry.length === 0)
            continue;
        const separator = entry.indexOf('=');
        if (separator <= 0)
            continue;
        environment[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
    return environment;
}
/**
 * Map a caller-supplied working directory onto a remote host. The harness
 * hands providers the session cwd, which is a local path when the harness
 * runs on the developer machine; a local absolute path (Windows drive, UNC)
 * or a relative path has no meaning on the remote host, so it is redirected
 * to the configured remote cwd. A POSIX absolute path is a remote path and
 * passes through unchanged.
 * @param fallback - the transport's default remote working directory.
 * @param cwd - the caller-supplied working directory, or `undefined` for the default.
 * @returns the remote working directory to execute in.
 */
export function resolveRemoteCwd(fallback, cwd) {
    if (cwd === undefined)
        return fallback;
    if (cwd.startsWith('ssh://')) {
        throw new Error('dsw: ssh:// working directories must be routed through ctx.subprocess or ctx.fs; ctx.ssh cannot choose a registry connection');
    }
    if (posix.isAbsolute(cwd))
        return cwd;
    if (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('//') || cwd.startsWith('\\\\'))
        return fallback;
    return posix.resolve(fallback, cwd);
}
/**
 * Observe one opened chain client for transport-level death. ssh2 emits a
 * bare `'error'` (e.g. a post-auth ECONNRESET) on the Client; with no
 * listener attached Node turns it into an uncaught exception that kills the
 * host process. The `'close'` event covers silent socket death without an
 * error. Both are terminal for the chain.
 * @param client - a client returned by (or handed to) {@link openChain}.
 * @param onDead - called at most once per client; the error is present for
 * the `'error'` path and absent for a clean/silent close.
 */
export function watchChainClient(client, onDead) {
    client.on('error', (error) => { onDead(error); });
    client.on('close', () => { onDead(); });
}
/**
 * One authenticated SSH session state shared by the aggregate runtime and the
 * registry-owned connections: the opened jump chain, the lazily shared SFTP
 * channel, and the cached remote login environment, plus disposal. Order and
 * failure semantics match the connection owner both callers used before the
 * extraction (target channel closed before the jump clients, partial chain
 * ended on failure, SFTP invalidated on close/end).
 */
export class SshSession {
    hosts;
    strict;
    knownHosts;
    options;
    clients = [];
    ready;
    sftp;
    sftpOpening;
    remoteEnvironment;
    disposed = false;
    connected = false;
    /** Bumped on every chain open; death events from stale chains are ignored. */
    generation = 0;
    constructor(hosts, strict, knownHosts, options = {}) {
        this.hosts = hosts;
        this.strict = strict;
        this.knownHosts = knownHosts;
        this.options = options;
    }
    /**
     * Return the shared live connection after the jump chain and auth succeed.
     * @param signal - caller lifetime; absent for the service runtime (unchanged API).
     * @returns the authenticated target client.
     * @throws when connection, jump, or authentication fails, or when disposing.
     */
    async getClient(signal) {
        signal?.throwIfAborted();
        if (this.disposed)
            throw new Error(this.disposedMessage());
        if (this.ready === undefined) {
            const attempt = this.open();
            this.ready = attempt;
            // A FAILED attempt is never cached: an auth stub, a bounced port, or a
            // VM that came back online must be able to retry on the next call (the
            // failed-connection-cache root fix). The rejection still propagates to
            // every caller awaiting this attempt; the next caller starts fresh.
            void attempt.catch(() => {
                if (this.ready === attempt)
                    this.ready = undefined;
            });
        }
        let client;
        try {
            client = await this.ready;
        }
        catch (error) {
            throw this.rewrapConnect(error);
        }
        signal?.throwIfAborted();
        if (this.disposed)
            throw new Error(this.disposedMessage());
        return client;
    }
    /**
     * Return the shared SFTP channel, opened lazily once per connection. A
     * closed connection invalidates it so the next call reopens.
     * @param signal - caller lifetime; absent for the service runtime.
     * @returns the live SFTP wrapper.
     */
    async getSftp(signal) {
        if (this.disposed)
            throw new Error(this.disposedMessage());
        if (this.sftp !== undefined)
            return this.sftp;
        this.sftpOpening ??= this.openSftp(signal);
        const sftp = await this.sftpOpening;
        if (this.sftp === undefined)
            this.sftp = sftp;
        return sftp;
    }
    /**
     * Return the remote login environment, read once per connection and cached.
     * The login environment is stable for the connection lifetime, so adapters
     * avoid one control command per spawned process.
     * @param signal - caller lifetime; absent for the service runtime.
     * @returns the remote environment as name/value entries.
     */
    getRemoteEnvironment(signal) {
        if (this.disposed)
            return Promise.reject(new Error(this.disposedMessage()));
        this.remoteEnvironment ??= this.readRemoteEnvironment(signal);
        return this.remoteEnvironment;
    }
    /**
     * Run one control-plane command with collected output. Used by adapters for
     * executable lookup and canonical-path resolution, not for user work.
     * @param command - remote command text (already shell-quoted by the caller).
     * @param opts - optional working-directory override and cancellation.
     * @returns the collected exit facts and output.
     */
    async exec(command, opts) {
        opts?.signal?.throwIfAborted();
        const cwdMapper = this.options.resolveRemoteCwd;
        const resolvedCwd = opts?.cwd !== undefined
            ? (cwdMapper !== undefined ? cwdMapper(opts.cwd) : opts.cwd)
            : undefined;
        const text = resolvedCwd !== undefined ? wrapCwd(resolvedCwd, command) : command;
        for (let attempt = 0;; attempt += 1) {
            const client = await this.getClient(opts?.signal);
            try {
                const outcome = await execChannel(client, text, opts);
                opts?.signal?.throwIfAborted();
                return outcome;
            }
            catch (error) {
                // The cached chain's socket died before (or while) the channel
                // opened — drop the stale state and retry once on a fresh chain.
                if (attempt === 0 && isStaleSocketError(error)) {
                    this.invalidate();
                    continue;
                }
                throw error;
            }
        }
    }
    /** Release the chain and the shared SFTP channel (idempotent). */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.connected = false;
        if (this.sftp !== undefined) {
            const sftp = this.sftp;
            this.sftp = undefined;
            this.sftpOpening = undefined;
            try {
                sftp.end();
            }
            catch (_alreadyEnded) {
                // A closed SFTP channel is already quiescent.
            }
        }
        const clients = this.clients;
        this.clients = [];
        // End the target first so its channel closes before the jump sockets it rode.
        for (const client of clients.reverse()) {
            try {
                client.end();
            }
            catch (_alreadyEnded) {
                // A client that already ended is already quiescent.
            }
        }
    }
    disposedMessage() {
        return this.options.disposedMessage ?? 'SSH service is disposing';
    }
    /** Whether the chain reached ready and has not been disposed or invalidated. */
    isConnected() {
        return this.connected && !this.disposed;
    }
    rewrapConnect(error) {
        const rewrapped = this.options.connectErrorRewriter !== undefined ? this.options.connectErrorRewriter(error) : error;
        if (rewrapped instanceof Error && this.options.redactMessage !== undefined) {
            rewrapped.message = this.options.redactMessage(rewrapped.message);
        }
        return rewrapped;
    }
    async openSftp(signal) {
        const client = await this.getClient(signal);
        const sftp = await new Promise((resolve, reject) => {
            client.sftp((error, value) => {
                if (error !== undefined)
                    reject(error);
                else
                    resolve(value);
            });
        });
        const invalidate = () => {
            this.sftp = undefined;
            this.sftpOpening = undefined;
        };
        sftp.on('close', invalidate);
        sftp.on('end', invalidate);
        return sftp;
    }
    async readRemoteEnvironment(signal) {
        const { exitCode, stdout } = await this.exec('env -0', signal === undefined ? undefined : { signal });
        if (exitCode !== 0) {
            const suffix = this.options.label === undefined ? '' : ` of "${this.options.label}"`;
            throw new Error(this.options.redactMessage === undefined
                ? `dsw: cannot read the remote environment${suffix}`
                : this.options.redactMessage(`dsw: cannot read the remote environment${suffix}`));
        }
        return parseRemoteEnvironment(stdout);
    }
    async open() {
        const hosts = this.options.resolveHosts === undefined
            ? this.hosts
            : await this.options.resolveHosts(this.hosts);
        const generation = ++this.generation;
        const clients = await openChain(hosts, this.strict, this.knownHosts, this.options.hostVerifier, 
        // Attached before the connect attempt (issue BUG-5): from this moment
        // every `'error'` is observed, so a post-auth ECONNRESET can never
        // reach Node as an uncaught exception. See {@link handleChainDeath}
        // for the guard.
        (client) => {
            watchChainClient(client, (error) => { this.handleChainDeath(generation, error); });
        });
        this.clients = clients;
        this.connected = true;
        return clients[clients.length - 1];
    }
    /**
     * Death handler for one opened chain client of the given generation. Only
     * the current generation owns the session state: a failed connect attempt
     * is torn down by openChain itself, a superseding open has already bumped
     * the generation, and a dispose ends the clients deliberately — all three
     * are ignored here.
     */
    handleChainDeath(generation, error) {
        if (this.disposed || generation !== this.generation)
            return;
        this.invalidate(error);
    }
    /**
     * Drop every cached artifact of a dead connection so the next call reopens:
     * the ready promise, the shared SFTP channel (its own close/end handlers
     * also self-invalidate), and the cached login environment. The dead clients
     * are dropped too — a terminal `'error'`/`'close'` already ended them.
     *
     * Public because the exec/run retry path must drop a socket that died before
     * its `close` event was observed (the `isStaleSocketError` branch); the
     * `connected` guard keeps a concurrent death handler from double-invalidating.
     */
    invalidate(error) {
        if (!this.connected)
            return;
        this.connected = false;
        this.ready = undefined;
        this.sftp = undefined;
        this.sftpOpening = undefined;
        this.remoteEnvironment = undefined;
        this.clients = [];
        void error;
    }
}
//# sourceMappingURL=ssh-core.js.map