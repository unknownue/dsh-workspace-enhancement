/**
 * GENERATED from `core/vendor.json` by `npm run sync:core-manifest` — do not
 * edit by hand. `npm run check:static` fails when this file is stale.
 */
/**
 * Official ripgrep release used when the remote host has no `rg` of its own.
 * Fetched at deploy time on the HOST, verified against {@link RG_VENDOR.sha256},
 * then pushed with the core; the plugin itself never redistributes it.
 */
export declare const RG_VENDOR: {
    readonly version: "15.2.0";
    readonly arch: "x86_64-unknown-linux-musl";
    readonly url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz";
    readonly checksumUrl: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz.sha256";
    readonly sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c";
    readonly member: "ripgrep-15.2.0-x86_64-unknown-linux-musl/rg";
    readonly license: "MIT OR UNLICENSE";
    readonly homepage: "https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0";
};
/**
 * bubblewrap has no upstream binary release (source tarball only), so it is
 * NEVER redistributed or downloaded: the remote host must already provide it.
 * A missing `bwrap` refuses the fenced operation with these install hints.
 */
export declare const BWRAP_VENDOR: {
    readonly license: "LGPL-2.1-or-later";
    readonly homepage: "https://github.com/containers/bubblewrap";
    readonly installHints: readonly ["Debian/Ubuntu: sudo apt-get install -y bubblewrap", "Fedora/RHEL: sudo dnf install -y bubblewrap", "Arch: sudo pacman -S bubblewrap", "openSUSE: sudo zypper install bubblewrap"];
};
