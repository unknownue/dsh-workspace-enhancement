/**
 * BUG-8: read one member out of a gzip ustar without spawning `tar`.
 *
 * Host-side `core.deploy` used to `spawnSync('tar')`. On Windows the first
 * `tar` on PATH is often Git-Bash/MSYS GNU tar, which corrupts `-xzOf`
 * stdout (MANIFEST.json becomes garbage JSON) and whose stderr we discarded.
 * The remote Linux extract in `coreInstallScript` still uses GNU tar; this
 * module is the host-side replacement.
 *
 * Stdlib only (`node:zlib`) so it runs inside the DSH file sandbox.
 *
 * @module dsh-workspace-enhancement/gzip-tar
 */
/** Strip `./` and trailing slashes so `./MANIFEST.json` matches `MANIFEST.json`. */
export declare function normalizeTarMember(name: string): string;
/**
 * Pack a gzip ustar from an in-memory file map. Used by tests so they do not
 * depend on PATH `tar` (the same MSYS bug this module exists to avoid).
 */
export declare function packGzipTar(files: Record<string, string | Uint8Array>): Buffer;
/**
 * Extract one regular-file member. Throws a message that already names the
 * archive and the member — callers surface it as-is (BUG-8: do not swallow
 * the reason the way PATH tar's ignored stderr did).
 */
export declare function extractGzipTarMember(archive: string, member: string): Buffer;
/** Write {@link extractGzipTarMember} to `target`. Returns an error detail or undefined. */
export declare function extractGzipTarMemberToFile(archive: string, member: string, target: string): string | undefined;
