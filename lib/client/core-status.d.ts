/**
 * REQ-I5: settings-page copy for a core.deploy / core.status payload.
 * Logic lives here so `settings.tsx` stays view-only (sandbox tests skip `.tsx`).
 *
 * @module dsh-workspace-enhancement/client/core-status
 */
export interface CoreStatusPayload {
    ok?: boolean;
    version?: string;
    arch?: string;
    proto?: number;
    caps?: readonly string[];
    sandbox?: string;
    detail?: string;
}
/** One-line status for the settings machine row. */
export declare function coreStatusLabel(view: CoreStatusPayload, t: (key: 'settings.core.ok' | 'settings.core.missing' | 'settings.core.unsupported', params?: Record<string, unknown>) => string): string;
