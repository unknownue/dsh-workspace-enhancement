/**
 * REQ-I5: upload a core tarball over SFTP and point `~/.dsh-core/current` at it.
 *
 * Operator action only — never triggered by a model tool.
 *
 * INFRA-15: the tarball carries only the first-party `dsh-core`. Optional
 * third-party tools are provisioned separately — `rg` is fetched from its
 * official release on the host (or skipped when the remote already has one) and
 * pushed beside the core; `bwrap` is never shipped and must come from the remote
 * host's own package manager, so its absence is reported here as a note and
 * refuses fenced work later.
 *
 * @module dsh-workspace-enhancement/core-deploy
 */
import { type CoreStatusView } from './core-hub.ts';
import type { SshTransport } from './transport.ts';
/** One extra executable pushed beside the core after extraction. */
export interface VendorFile {
    /** Absolute path of the uploaded temp file on the remote. */
    temp: string;
    /** Path relative to `~/.dsh-core/<version>/`. */
    relative: string;
}
export declare function localCoreTarball(): string;
/**
 * Pure MANIFEST gate: every required file listed with a sha256. Returns the
 * list of problems; empty = the tarball can be deployed as-is.
 */
export declare function manifestIssues(manifest: unknown): string[];
/**
 * Read MANIFEST.json out of the tarball with the in-process gzip/ustar
 * extractor (BUG-8: never spawn PATH `tar` on the host). Throws with a
 * message that already names the archive — callers surface it as-is.
 */
export declare function readTarballManifest(artifact: string): unknown;
export declare function assertLinuxAmd64(unameS: string, unameM: string): void;
/**
 * Remote extract + chmod + current symlink. Windows-built tarballs land as 644,
 * so every executable must be chmod'ed explicitly; `vendors` are the extra
 * tools uploaded for this deploy (only what we actually pushed is listed).
 */
export declare function coreInstallScript(version: string, remoteTar: string, vendors?: readonly VendorFile[]): string;
/** Remote probe for the tools that decide what this deploy has to push. */
export declare function remoteToolProbe(): string;
/**
 * Development aid: names the deploy should treat as ABSENT on the remote even
 * when the probe finds them (`DSW_CORE_VENDOR_FORCE_MISSING=rg,bwrap`). The
 * fetch-and-push branch is otherwise only reachable on a host that genuinely
 * lacks the tool, which makes it painful to exercise locally.
 *
 * @returns the forced names, lowercased, without blanks or duplicates.
 */
export declare function forcedMissingTools(raw?: string | undefined): readonly string[];
/**
 * Which of the optional tools the remote already has, honouring
 * {@link forcedMissingTools}.
 *
 * @param probeStdout - the output of {@link remoteToolProbe}.
 * @param forced - names to treat as absent regardless of the probe.
 */
export declare function remoteToolsPresent(probeStdout: string, forced?: readonly string[]): {
    rg: boolean;
    bwrap: boolean;
};
/**
 * Deploy the linux-x64 tarball to the login user's `~/.dsh-core/<version>/`.
 *
 * Never fails just because an optional tool is unavailable: the core is still
 * deployed and the returned detail explains what is missing and where the
 * official copy comes from.
 */
export declare function deployCore(transport: SshTransport, options?: {
    artifact?: string | undefined;
    signal?: AbortSignal | undefined;
}): Promise<CoreStatusView>;
export declare function coreStatusViaExec(transport: SshTransport, signal?: AbortSignal): Promise<CoreStatusView>;
