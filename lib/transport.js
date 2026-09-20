/**
 * Execution-world transport shared by the SSH subprocess and filesystem
 * providers. The aggregate `ctx.ssh` service is the default transport; an
 * `ssh://<connectionId>/<path>` working directory routes one operation to a
 * registry-owned connection instead, so sessions created from the web
 * connection manager execute on the host they were opened against.
 *
 * The web client cannot pass an `ssh://` cwd to `sessions.create` — the host's
 * session service unconditionally `mkdir`s the project directory through
 * `node:fs`. So each remote route also has a LOCAL placeholder directory
 * (`<dsh home>/dsw-routes/<id>/<remote path>`; the pre-rename
 * `dsh-ssh-routes/` tree keeps routing for live sessions) that the client
 * registers and hands to `sessions.create`; both spellings route to the same
 * registry connection here.
 * @module dsh-workspace-enhancement/transport
 */
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { isRegistryConnectionId, parseSshRoute } from "./registry.js";
import { hostLocaleOf } from "./locale/host.js";
import { initiatorSessionOf } from "./remote-policy.js";
/** Build the opaque target key used by the filesystem backend for one route. */
export function sshTargetKey(connectionId, path) {
    return `ssh://${connectionId}${path}`;
}
/** Split a filesystem target key into its transport route and remote path. */
export function parseSshTargetKey(targetKey) {
    const route = parseSshRoute(targetKey);
    if (route !== null)
        return { connectionId: route.id, path: route.path };
    const placeholder = routeFromPlaceholder(targetKey);
    if (placeholder !== null)
        return { connectionId: placeholder.id, path: placeholder.path };
    return { path: targetKey };
}
/** Root of the local placeholder tree standing in for remote routes. */
export function sshRoutesRoot(dshBase) {
    return resolve(dshBase ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsw-routes');
}
/** Root of the pre-rename placeholder tree (kept routable for live sessions). */
function legacySshRoutesRoot(dshBase) {
    return resolve(dshBase ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-ssh-routes');
}
/** The local placeholder path of one registry route (created by `session.route`). */
export function sshRoutePlaceholder(connectionId, remotePath) {
    const segments = remotePath.split('/').filter(segment => segment !== '');
    return join(sshRoutesRoot(), connectionId, ...segments);
}
/**
 * Recover the registry route a local placeholder names
 * (`<root>/<id>/<remote path…>` → connection id + absolute POSIX path). Both
 * the current `dsw-routes` root and the pre-rename `dsh-ssh-routes` tree are
 * accepted, so an existing session cwd never breaks. The lexical comparison
 * is retried against the filesystem-canonical forms (realpath) of both sides
 * when the value exists: a caller-side canonicalization of the placeholder
 * (junction/8.3 alias on Windows) must never turn a remote session cwd into a
 * local one.
 */
function routeFromPlaceholder(value, dshBase) {
    const lowered = value.toLowerCase();
    if (!lowered.includes('dsw-routes') && !lowered.includes('dsh-ssh-routes'))
        return null;
    const root = lowered.includes('dsw-routes') ? sshRoutesRoot(dshBase) : legacySshRoutesRoot(dshBase);
    let rel = relative(root, resolve(value));
    if ((rel === '' || rel.startsWith('..') || isAbsolute(rel)) && existsSync(value) && existsSync(root)) {
        try {
            rel = relative(realpathSync(root), realpathSync(value));
        }
        catch {
            // An unreadable canonical form leaves the lexical answer in charge.
        }
    }
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
        return null;
    const segments = rel.split(/[\\/]+/).filter(segment => segment !== '');
    const id = segments[0];
    if (id === undefined || !isRegistryConnectionId(id))
        return null;
    const rest = segments.slice(1);
    return { id, path: rest.length === 0 ? '/' : `/${rest.join('/')}` };
}
/**
 * Resolve ANY session-cwd spelling to its remote route, or null for a local
 * session (zero prompt injection). Three spellings select the same registry
 * connection: the `ssh://<id>/<path>` form and both local placeholder trees
 * (`dsw-routes/<id>/…`, pre-rename `dsh-ssh-routes/<id>/…`).
 * @param cwd - the session's header cwd.
 * @param dshBase - DSH home override (tests); defaults to the environment.
 */
export function remoteRouteFromCwd(cwd, dshBase) {
    if (cwd === undefined)
        return null;
    const parsed = cwd.startsWith('ssh://') ? parseSshRoute(cwd) : routeFromPlaceholder(cwd, dshBase);
    if (parsed === null)
        return null;
    return { connectionId: parsed.id, path: parsed.path };
}
function registryConnectionOf(ctx, id) {
    const registry = ctx.get('sshRegistry');
    return registry?.get(id);
}
function posixRemoteCwd(path) {
    const cleaned = posix.normalize(path).replace(/\/+$/u, '');
    return cleaned === '' ? '/' : cleaned;
}
/**
 * Bind a path to the calling session's registry machine. Official tools on a
 * Windows host pass POSIX `/home/…` (and sometimes `ssh://.git/…`) which are
 * not `ssh://<id>/…` routes; without this they fall through to aggregate
 * `ctx.ssh` and have no connection id.
 */
function initiatorBind(ctx, remotePath) {
    const initiator = remoteRouteFromCwd(initiatorSessionOf(ctx)?.header?.cwd);
    if (initiator === null)
        return undefined;
    const connection = registryConnectionOf(ctx, initiator.connectionId);
    if (connection === undefined)
        return undefined;
    const absolute = posix.isAbsolute(remotePath) ? remotePath : posix.resolve(initiator.path, remotePath);
    return { transport: connection, cwd: posixRemoteCwd(absolute), connectionId: initiator.connectionId };
}
/**
 * Resolve one caller cwd against the transport it names. POSIX absolute paths
 * and the normal local-path redirection stay on the aggregate `ctx.ssh`;
 * `ssh://<id>/<path>` and its local placeholder both select the live registry
 * connection for that id.
 */
export function resolveSshCwd(ctx, cwd) {
    if (cwd !== undefined) {
        const parsed = cwd.startsWith('ssh://') ? parseSshRoute(cwd) : routeFromPlaceholder(cwd);
        if (parsed !== null) {
            const connection = registryConnectionOf(ctx, parsed.id);
            if (connection === undefined) {
                throw new Error(`dsw: ${hostLocaleOf(ctx).t('rpc.workdirUnknownConnection', { id: parsed.id })}`);
            }
            return { transport: connection, cwd: parsed.path, connectionId: parsed.id };
        }
        if (cwd.startsWith('ssh://')) {
            const rest = cwd.slice('ssh://'.length);
            // `ssh://.git/HEAD` is a git-dir spelling, not machine id `.git`.
            const bound = rest.startsWith('.') ? initiatorBind(ctx, rest) : undefined;
            if (bound !== undefined)
                return bound;
            throw new Error(`dsw: ${hostLocaleOf(ctx).t('rpc.invalidWorkdir', { dir: JSON.stringify(cwd) })}`);
        }
        // On Windows a POSIX absolute cwd is already classified remote (mixed.ts)
        // but is not a placeholder. Bind it to the initiator session's machine so
        // official bash/fs calls that pass `/home/…` still hit the registry SSH
        // connection instead of the aggregate `ctx.ssh` (no connection id).
        if (posix.isAbsolute(cwd)) {
            const bound = initiatorBind(ctx, cwd);
            if (bound !== undefined)
                return bound;
        }
    }
    return { transport: ctx.ssh, cwd: ctx.ssh.resolveRemoteCwd(cwd) };
}
/** Resolve an encoded filesystem target key against its owning transport. */
export function resolveSshTargetKey(ctx, targetKey) {
    const parsed = parseSshTargetKey(targetKey);
    if (parsed.connectionId === undefined) {
        return { transport: ctx.ssh, cwd: ctx.ssh.resolveRemoteCwd(parsed.path), path: parsed.path };
    }
    const registry = ctx.get('sshRegistry');
    const connection = registry?.get(parsed.connectionId);
    if (connection === undefined) {
        throw new Error(`dsw: ${hostLocaleOf(ctx).t('rpc.targetUnknownConnection', { id: parsed.connectionId })}`);
    }
    return { transport: connection, cwd: parsed.path, connectionId: parsed.connectionId, path: parsed.path };
}
//# sourceMappingURL=transport.js.map