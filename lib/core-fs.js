/**
 * REQ-I5: FileSystemBranch backed by a core RPC session.
 * editText stays host-side (read + patch + fs.write).
 *
 * @module dsh-workspace-enhancement/core-fs
 */
import { Buffer } from 'node:buffer';
import { posix } from 'node:path';
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs';
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox';
import { CoreRpcError } from "./core-client.js";
import { CORE_ERROR_NOT_FOUND, CORE_ERROR_READ_ONLY, CORE_METHODS, asRecord } from "./core-protocol.js";
import { RemoteSandboxError } from "./remote-sandbox.js";
import { initiatorSessionOf, isConfinedSandboxMode, resolveRemoteSessionMode, sftpFallbackForCoreGap, } from "./remote-policy.js";
import { parseSshTargetKey, resolveSshCwd, resolveSshTargetKey, sshTargetKey } from "./transport.js";
const BINARY_SAMPLE_BYTES = 8192;
function assertNotAborted(signal, operation) {
    if (signal?.aborted === true)
        throw new FsError(`${operation} aborted`, 'FS_ABORTED');
}
function normalizeLineEndings(value) {
    return value.replaceAll('\r\n', '\n');
}
function detectsCrlf(value) {
    const sample = value.slice(0, 4096);
    const crlf = sample.split('\r\n').length - 1;
    const lf = sample.split('\n').length - 1 - crlf;
    return crlf > lf;
}
function restoreLineEndings(value, crlf) {
    return crlf ? normalizeLineEndings(value).replaceAll('\n', '\r\n') : value;
}
function decodeText(bytes, displayPath) {
    if (bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
        throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT');
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        throw new FsError(`cannot read "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT', { cause: error });
    }
}
function literalEdit(content, request, displayPath) {
    const oldString = normalizeLineEndings(request.oldString);
    const newString = normalizeLineEndings(request.newString);
    if (oldString.length === 0) {
        throw new FsError(`cannot edit "${displayPath}": old_string must be non-empty`, 'FS_EDIT_NOT_FOUND');
    }
    let matches = 0;
    let offset = 0;
    while (true) {
        const found = content.indexOf(oldString, offset);
        if (found < 0)
            break;
        matches += 1;
        offset = found + oldString.length;
    }
    if (matches === 0)
        throw new FsError(`cannot edit "${displayPath}": old_string was not found`, 'FS_EDIT_NOT_FOUND');
    if (!request.replaceAll && matches !== 1) {
        throw new FsError(`cannot edit "${displayPath}": old_string matched ${matches} times`, 'FS_AMBIGUOUS_EDIT');
    }
    return request.replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
}
function sandboxDenied(operation, displayPath, mode, cause) {
    const marker = sandboxDenialMarker(mode);
    const message = `cannot ${operation} "${displayPath}": file access denied under ${mode} mode ${marker}`;
    if (cause !== undefined)
        return new FsError(message, 'FS_SANDBOX_DENIED', { cause });
    return new FsError(message, 'FS_SANDBOX_DENIED');
}
function mapRpc(error, operation, displayPath, signal, mode = 'workspace-write') {
    if (error instanceof FsError)
        return error;
    if (signal?.aborted === true)
        return new FsError(`${operation} aborted`, 'FS_ABORTED', { cause: error });
    if (error instanceof RemoteSandboxError) {
        return new FsError(error.message, 'FS_SANDBOX_DENIED', { cause: error });
    }
    const code = error instanceof CoreRpcError ? error.code : '';
    const message = error instanceof Error ? error.message : String(error);
    if (code === CORE_ERROR_NOT_FOUND || /ENOENT|not found/i.test(message)) {
        return new FsError(`cannot ${operation} "${displayPath}": not found`, 'FS_NOT_FOUND', { cause: error });
    }
    if (code === CORE_ERROR_READ_ONLY || /EROFS|read-only/i.test(message)) {
        return sandboxDenied(operation, displayPath, mode, error);
    }
    if (/EACCES|permission denied/i.test(`${code} ${message}`)) {
        if (isConfinedSandboxMode(mode))
            return sandboxDenied(operation, displayPath, mode, error);
        return new FsError(`cannot ${operation} "${displayPath}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error });
    }
    return new FsError(`cannot ${operation} "${displayPath}": ${message}`, 'FS_IO_ERROR', { cause: error });
}
function isMissingRpc(error) {
    const code = error instanceof CoreRpcError ? error.code : '';
    const message = error instanceof Error ? error.message : String(error);
    return code === CORE_ERROR_NOT_FOUND || /ENOENT|not found/i.test(message);
}
/**
 * Official Write resolves a path before the file exists. Local dsh-fs-local
 * realpaths the nearest existing ancestor; deployed cores that still
 * EvalSymlinks the leaf need the same walk on this side.
 */
export async function realpathAllowMissing(lookup, path, signal) {
    try {
        return await lookup(path, signal);
    }
    catch (error) {
        if (!isMissingRpc(error))
            throw error;
    }
    const leaf = posix.basename(path);
    const missing = leaf === '' || leaf === '/' ? [] : [leaf];
    let ancestor = posix.dirname(path);
    while (true) {
        try {
            const realAncestor = await lookup(ancestor, signal);
            return missing.length === 0 ? realAncestor : posix.join(realAncestor, ...missing);
        }
        catch (error) {
            if (!isMissingRpc(error))
                throw error;
            const parent = posix.dirname(ancestor);
            if (parent === ancestor)
                return path;
            const base = posix.basename(ancestor);
            if (base !== '')
                missing.unshift(base);
            ancestor = parent;
        }
    }
}
function asStat(raw) {
    const rec = asRecord(raw);
    if (rec === undefined)
        return undefined;
    const type = rec.type === 'file' || rec.type === 'directory' || rec.type === 'other'
        ? rec.type
        : rec.type === 'symlink' ? 'other' : 'other';
    const version = FsVersion(typeof rec.version === 'string' ? rec.version : 'core:unknown');
    if (type === 'file' && typeof rec.size === 'number')
        return { type, version, size: rec.size };
    return { type, version };
}
export class CoreFileSystem {
    ctx;
    client;
    mode;
    locks = new Map();
    constructor(ctx, client, mode = 'workspace-write') {
        this.ctx = ctx;
        this.client = client;
        this.mode = mode;
    }
    processPathFromHostPath(_hostPath) {
        return undefined;
    }
    processPath(target) {
        return resolveSshTargetKey(this.ctx, String(target.targetKey)).path;
    }
    fileUrl(target) {
        const path = this.processPath(target);
        return `file://${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
    }
    contains(parent, child) {
        const parentRoute = parseSshTargetKey(String(parent.targetKey));
        const childRoute = parseSshTargetKey(String(child.targetKey));
        if (parentRoute.connectionId !== childRoute.connectionId)
            return false;
        const relative = posix.relative(parentRoute.path, childRoute.path);
        return relative === '' || (relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative));
    }
    async resolve(path, opts) {
        assertNotAborted(opts?.signal, 'resolve');
        if (path.trim().length === 0)
            throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND');
        const route = resolveSshCwd(this.ctx, opts?.cwd);
        const remotePath = posix.resolve(route.cwd, path);
        const displayPath = route.connectionId === undefined ? remotePath : sshTargetKey(route.connectionId, remotePath);
        try {
            const canonical = await realpathAllowMissing(async (probe, signal) => {
                const ok = asRecord(await this.client.call(CORE_METHODS.fsRealpath, { path: probe }, signal));
                return typeof ok?.path === 'string' ? ok.path : probe;
            }, remotePath, opts?.signal);
            const targetKey = route.connectionId === undefined ? canonical : sshTargetKey(route.connectionId, canonical);
            return { targetKey: FsTargetKey(targetKey), displayPath };
        }
        catch (error) {
            throw mapRpc(error, 'resolve', displayPath, opts?.signal, this.mode);
        }
    }
    async stat(target, signal) {
        assertNotAborted(signal, 'stat');
        const route = resolveSshTargetKey(this.ctx, String(target.targetKey));
        try {
            const raw = await this.client.call(CORE_METHODS.fsStat, { path: route.path }, signal);
            const st = asStat(raw);
            if (st === undefined)
                return undefined;
            return { version: st.version, type: st.type, ...(st.size !== undefined ? { size: st.size } : {}) };
        }
        catch (error) {
            throw mapRpc(error, 'stat', target.displayPath, signal, this.mode);
        }
    }
    async lstat(path, opts, signal) {
        assertNotAborted(signal, 'lstat');
        const route = resolveSshCwd(this.ctx, opts?.cwd);
        const remotePath = posix.resolve(route.cwd, path);
        const displayPath = route.connectionId === undefined ? remotePath : sshTargetKey(route.connectionId, remotePath);
        try {
            const raw = await this.client.call(CORE_METHODS.fsLstat, { path: remotePath }, signal);
            const st = asStat(raw);
            if (st === undefined)
                return undefined;
            return { version: st.version, type: st.type, ...(st.size !== undefined ? { size: st.size } : {}) };
        }
        catch (error) {
            throw mapRpc(error, 'lstat', displayPath, signal, this.mode);
        }
    }
    async readText(target, signal) {
        const bytes = await this.readBytes(target, signal, Number.POSITIVE_INFINITY);
        return decodeText(bytes, target.displayPath);
    }
    async readBytes(target, signal, maxBytes) {
        const info = await this.stat(target, signal);
        if (info === undefined)
            throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND');
        if (info.type !== 'file')
            throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE');
        if (info.size !== undefined && info.size > maxBytes) {
            throw new FsError(`cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE');
        }
        const route = resolveSshTargetKey(this.ctx, String(target.targetKey));
        try {
            const rec = asRecord(await this.client.call(CORE_METHODS.fsRead, { path: route.path }, signal));
            const bytes = Buffer.from(String(rec?.b64 ?? ''), 'base64');
            if (bytes.length > maxBytes) {
                throw new FsError(`cannot read "${target.displayPath}": ${bytes.length} bytes exceeds the ${maxBytes}-byte limit`, 'FS_TOO_LARGE');
            }
            return bytes;
        }
        catch (error) {
            throw mapRpc(error, 'read', target.displayPath, signal, this.mode);
        }
    }
    async readByteRange(target, range, signal) {
        if (range.length === 0)
            return new Uint8Array(0);
        const route = resolveSshTargetKey(this.ctx, String(target.targetKey));
        try {
            const rec = asRecord(await this.client.call(CORE_METHODS.fsReadRange, {
                path: route.path,
                offset: range.offset,
                length: range.length,
            }, signal));
            return Buffer.from(String(rec?.b64 ?? ''), 'base64');
        }
        catch (error) {
            throw mapRpc(error, 'read', target.displayPath, signal, this.mode);
        }
    }
    async streamText(target, signal) {
        const text = await this.readText(target, signal);
        return {
            async *[Symbol.asyncIterator]() {
                yield text;
            },
        };
    }
    async listDir(target, signal) {
        const info = await this.stat(target, signal);
        if (info === undefined)
            throw new FsError(`cannot list "${target.displayPath}": not found`, 'FS_NOT_FOUND');
        if (info.type !== 'directory')
            throw new FsError(`cannot list "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY');
        const route = resolveSshTargetKey(this.ctx, String(target.targetKey));
        try {
            const rec = asRecord(await this.client.call(CORE_METHODS.fsListDir, { path: route.path }, signal));
            const entries = Array.isArray(rec?.entries) ? rec.entries : [];
            const out = [];
            for (const item of entries) {
                const row = asRecord(item);
                if (row === undefined || typeof row.name !== 'string')
                    continue;
                const childRemote = posix.join(route.path, row.name);
                const st = asStat(row);
                const childKey = route.connectionId === undefined ? childRemote : sshTargetKey(route.connectionId, childRemote);
                const childDisplay = route.connectionId === undefined ? childRemote : sshTargetKey(route.connectionId, childRemote);
                out.push({
                    name: row.name,
                    type: st?.type ?? 'other',
                    target: { targetKey: FsTargetKey(childKey), displayPath: childDisplay },
                    version: st?.version ?? FsVersion('core:unknown'),
                    ...(st?.size !== undefined ? { size: st.size } : {}),
                });
            }
            return out.sort((left, right) => left.name.localeCompare(right.name));
        }
        catch (error) {
            throw mapRpc(error, 'list', target.displayPath, signal, this.mode);
        }
    }
    async writeText(target, content, expected, signal) {
        return this.withLock(String(target.targetKey), async () => {
            const existing = await this.stat(target, signal);
            if (existing !== undefined && existing.type !== 'file') {
                throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE');
            }
            if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
                throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED');
            }
            if (expected?.kind === 'replaceIfVersion' && existing !== undefined && existing.version !== expected.version) {
                throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION');
            }
            const before = existing === undefined ? null : normalizeLineEndings(await this.readText(target, signal).catch(() => ''));
            return this.writeUnlocked(target, content, expected?.kind === 'createIfAbsent', existing === undefined, before, signal);
        });
    }
    async editText(target, edit, expected, signal) {
        return this.withLock(String(target.targetKey), async () => {
            const existing = await this.stat(target, signal);
            if (existing === undefined) {
                throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION');
            }
            if (existing.type !== 'file') {
                throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE');
            }
            if (expected !== undefined && existing.version !== expected.version) {
                throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION');
            }
            const raw = await this.readText(target, signal);
            const before = normalizeLineEndings(raw);
            const after = literalEdit(before, edit, target.displayPath);
            const storage = restoreLineEndings(after, detectsCrlf(raw));
            const written = await this.writeUnlocked(target, storage, false, false, before, signal);
            return { version: written.version, before, after };
        });
    }
    async writeUnlocked(target, content, createIfAbsent, created, before, signal) {
        const route = resolveSshTargetKey(this.ctx, String(target.targetKey));
        try {
            const raw = await this.client.call(CORE_METHODS.fsWrite, {
                path: route.path,
                b64: Buffer.from(content, 'utf8').toString('base64'),
                createIfAbsent,
            }, signal);
            const st = asStat(raw);
            return {
                operation: created ? 'create' : 'update',
                version: st?.version ?? FsVersion('core:unknown'),
                before,
                after: normalizeLineEndings(content),
            };
        }
        catch (error) {
            throw mapRpc(error, 'write', target.displayPath, signal, this.mode);
        }
    }
    async withLock(targetKey, operation) {
        const prior = this.locks.get(targetKey) ?? Promise.resolve();
        const run = prior.then(operation, operation);
        const tail = run.then(() => undefined, () => undefined);
        this.locks.set(targetKey, tail);
        try {
            return await run;
        }
        finally {
            if (this.locks.get(targetKey) === tail)
                this.locks.delete(targetKey);
        }
    }
}
/**
 * Remote-world filesystem: core RPC when a Linux core is up.
 * REQ-I15: confined + missing core → **reads** fall back to SFTP (so host
 * project-root probes and official Read still work); writes stay fail-closed.
 * danger-full-access with no core stays today's SFTP for every face.
 */
export class CoreRoutingFileSystem {
    ctx;
    sftp;
    hub;
    constructor(ctx, sftp, hub) {
        this.ctx = ctx;
        this.sftp = sftp;
        this.hub = hub;
    }
    processPathFromHostPath(_hostPath) {
        return undefined;
    }
    async delegate(connectionId, opts, face = 'read') {
        const policy = resolveRemoteSessionMode(this.ctx, opts?.sandboxPolicy);
        if (connectionId === undefined)
            return this.sftp;
        const sessionCwd = opts?.cwd ?? initiatorSessionOf(this.ctx)?.header?.cwd;
        try {
            const client = await this.hub.require(connectionId, {
                policy,
                ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
                ...(opts?.path !== undefined ? { path: opts.path } : {}),
                ...(sessionCwd !== undefined ? { cwd: sessionCwd } : {}),
            });
            return new CoreFileSystem(this.ctx, client, policy);
        }
        catch (error) {
            if (sftpFallbackForCoreGap(policy, face, error))
                return this.sftp;
            throw mapRpc(error, 'use fenced core', connectionId, opts?.signal, policy);
        }
    }
    idOfTarget(target) {
        return parseSshTargetKey(String(target.targetKey)).connectionId;
    }
    pathOf(target) {
        return parseSshTargetKey(String(target.targetKey)).path;
    }
    targetOpts(target, signal, sandboxPolicy) {
        return {
            path: this.pathOf(target),
            ...(signal !== undefined ? { signal } : {}),
            ...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
        };
    }
    processPath(target) {
        return this.sftp.processPath(target);
    }
    fileUrl(target) {
        return this.sftp.fileUrl(target);
    }
    contains(parent, child) {
        return this.sftp.contains(parent, child);
    }
    async resolve(path, opts) {
        const route = resolveSshCwd(this.ctx, opts?.cwd);
        // BUG-4: a probe offers the TARGET as `path`, never as `cwd`. A cwd that is
        // not an already-declared root mints a sibling workspace-write jail
        // (`resolveCoreWorkspace`), so routing the silent project-root probe's own
        // path through `cwd` turned every ancestor into its own `--workspace` bind
        // (`/home/uuz`, `/home`, …). `path` only ever matches a declared root.
        return (await this.delegate(route.connectionId, {
            ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
            path: posix.resolve(route.cwd, path),
        })).resolve(path, opts);
    }
    async stat(target, signal) {
        return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).stat(target, signal);
    }
    async lstat(path, opts, signal) {
        const route = resolveSshCwd(this.ctx, opts?.cwd);
        // BUG-4: same rule as `resolve` — the probe target is a `path`, and the
        // delegate falls back to the initiator session's cwd for the jail.
        return (await this.delegate(route.connectionId, {
            ...(signal !== undefined ? { signal } : {}),
            path: posix.resolve(route.cwd, path),
        })).lstat(path, opts, signal);
    }
    async readText(target, signal) {
        return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).readText(target, signal);
    }
    async streamText(target, signal) {
        return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).streamText(target, signal);
    }
    async readBytes(target, signal, maxBytes) {
        return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).readBytes(target, signal, maxBytes);
    }
    async readByteRange(target, range, signal) {
        const branch = await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal));
        if (branch.readByteRange === undefined) {
            throw new FsError(`cannot read "${target.displayPath}": windowed reads are unavailable`, 'FS_IO_ERROR');
        }
        return branch.readByteRange(target, range, signal);
    }
    async listDir(target, signal) {
        return (await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal))).listDir(target, signal);
    }
    async writeText(target, content, expected, signal, sandboxPolicy) {
        const branch = await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal, sandboxPolicy), 'write');
        return branch.writeText(target, content, expected, signal, sandboxPolicy);
    }
    async editText(target, edit, expected, signal, sandboxPolicy) {
        const branch = await this.delegate(this.idOfTarget(target), this.targetOpts(target, signal, sandboxPolicy), 'write');
        return branch.editText(target, edit, expected, signal, sandboxPolicy);
    }
}
//# sourceMappingURL=core-fs.js.map