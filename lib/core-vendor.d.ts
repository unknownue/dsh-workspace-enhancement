/**
 * INFRA-15: provision the OPTIONAL third-party tool the remote core can use
 * without this repository redistributing anything.
 *
 * Policy (agreed 2026-09-16):
 *   - `rg` — if the remote host has its own `ripgrep`, use it and push nothing.
 *     Otherwise fetch the OFFICIAL static release on the HOST, verify it against
 *     {@link RG_VENDOR.sha256}, cache it under `$DSH_HOME/cache/dsw-core-vendor/`
 *     and push that single file beside the core. A failed fetch never blocks the
 *     core deploy: the status detail names the official address and the cache
 *     path where a hand-downloaded copy can be dropped instead.
 *   - `bwrap` — never downloaded and never redistributed (upstream publishes
 *     source only). The remote must provide it; the core refuses fenced work
 *     with the install hints from {@link BWRAP_VENDOR}.
 *
 * Network: `curl` (present on Windows 10+, macOS and virtually every Linux) so
 * `https_proxy`/`http_proxy` are honoured. `DSW_CORE_VENDOR_PROXY` overrides the
 * proxy, `DSW_CORE_VENDOR_BASE_URL` mirrors the official download prefix,
 * `DSW_CORE_VENDOR_OFFLINE=1` forbids the network entirely.
 *
 * @module dsh-workspace-enhancement/core-vendor
 */
/** Root of the host-side vendor cache. */
export declare function coreVendorRoot(): string;
/** One tool's cache directory: `<name>-<version>-<arch>`. */
export declare function coreVendorDir(name: string, version: string, arch: string): string;
/**
 * One pinned official artifact: where it comes from, what it must hash to, and
 * which member to extract. Kept as a parameter (not read from the pins
 * directly) so tests can run the whole path with a locally built tarball.
 */
export interface VendorSource {
    /** Cache/tool name, e.g. `rg`. */
    name: string;
    version: string;
    arch: string;
    /** Official artifact URL. */
    url: string;
    /** Pinned sha256 of that artifact (lowercase hex). */
    sha256: string;
    /** Path of the executable inside the tarball. */
    member: string;
}
/** The pinned ripgrep source. */
export declare function rgSource(): VendorSource;
/** Directory holding the cached `rg` binary. */
export declare function rgCacheDir(): string;
/** Cached `rg` binary path (the file pushed to the remote when needed). */
export declare function rgCachePath(): string;
/** sha256 of a buffer, lowercase hex. */
export declare function sha256Of(data: Buffer | string): string;
/** sha256 of a file, lowercase hex. */
export declare function fileSha256(path: string): string;
/**
 * Cache path of one tool's executable.
 * @param source - the pinned source.
 */
export declare function vendorCachePath(source: VendorSource): string;
/**
 * The cached executable, when its digest sidecar still matches.
 * @param source - the pinned source.
 * @returns the path, or undefined when the cache is empty/corrupt.
 */
export declare function cachedVendor(source: VendorSource): string | undefined;
/**
 * The cached `rg` binary, when its digest sidecar still matches.
 * @returns the path, or undefined when the cache is empty/corrupt.
 */
export declare function cachedRg(): string | undefined;
/**
 * Apply the mirror override to one official URL.
 * @param url - the pinned official URL.
 * @returns the override-prefixed URL, or `url` unchanged.
 */
export declare function vendorUrl(url: string): string;
/** Configured proxy for the vendor download, if any. */
export declare function vendorProxy(): string | undefined;
/** Outcome of provisioning the optional search tool. */
export type RgVendorOutcome = {
    ok: true;
    path: string;
    cached: boolean;
} | {
    ok: false;
    detail: string;
};
/** Injectable download seam so tests never touch the network. */
export type VendorDownload = (url: string, target: string, proxy: string | undefined) => string | undefined;
/**
 * Ensure a verified copy of one pinned official tool exists in the host cache.
 * Fetches, verifies the pinned sha256, extracts the member and stores it with a
 * digest sidecar. Nothing is cached unless every check passed.
 *
 * @param source - the pinned source (see {@link rgSource}).
 * @param download - download seam (tests inject a local writer).
 * @returns the cached path, or an actionable failure detail.
 */
export declare function ensureVendor(source: VendorSource, download?: VendorDownload): RgVendorOutcome;
/**
 * Ensure a verified `rg` binary exists in the host cache.
 * @returns the cached path, or an actionable failure detail.
 */
export declare function ensureRgVendor(download?: VendorDownload): RgVendorOutcome;
/** bwrap install hints, for the refusal message the model and the operator read. */
export declare function bwrapInstallHints(): readonly string[];
/** Official bubblewrap source address (there is no upstream binary release). */
export declare function bwrapHomepage(): string;
