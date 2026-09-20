/**
 * Minimal remote-machine management settings page (machine registry edition):
 * machine list (edit / delete / set current / forget host key) plus the shared
 * {@link MachineForm} (mode="settings") — one form component with the flow's
 * add-connection form (R2 表单并集; see docs/ui-merge-design.md). No forwards /
 * audit / update sections — those belong to dsh-remote only and are
 * deliberately not ported.
 *
 * All data rides the package's `/dsw` RPC channel (machines.*, hostkey.forget).
 *
 * Styling lives in `settings.module.css` and resolves through the host's
 * `--dsw-*` design tokens, so the page inherits the DeepSeek Harness settings
 * vocabulary (16/24 title, 14/22 body, outlined row cards, one filled editor
 * module, capsule buttons) and follows the dark theme automatically. The page
 * renders inside the host panel's `.options` area and therefore adds no outer
 * padding or surface of its own — see the stylesheet header.
 * @module dsh-workspace-enhancement/settings
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { WireResult } from './index.ts';
import type { MachineSaveView } from './machine-form.tsx';
import type { CoreStatusPayload } from './core-status.ts';
/** The `/dsw` RPC face injected by the client plugin. */
export interface SettingsInjected {
    rpc(endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<WireResult>;
    /** Typed translate seat (slot-injected once the registration declares `locale`). */
    t?: TranslateNS<'dsw'>;
}
/** Owner share of a `settings.section` entry (the shell supplies `close`). */
export interface SettingsOwnerProps {
    close(): void;
}
/**
 * F2: the durable save acknowledgment. The machine form's success text cannot
 * persist — the form remounts when `key={editing?.id}` changes and any in-form
 * feedback vanishes with it — so the settings page owns the banner. The
 * honest fallback marker (encryption requested, OS backend failed) rides
 * along as pure text (no live data; a `MachineSaveView` leaf).
 */
export declare function savedBanner(view: MachineSaveView, t?: TranslateNS<'dsw'>): string;
/** Core-status tone, so the chip can carry the host's semantic state color. */
export type CoreTone = 'ok' | 'warn' | 'error';
/** One machine's last core status: copy + the tone its chip renders in. */
export interface CoreLine {
    label: string;
    tone: CoreTone;
}
/**
 * Tone of a core.status / core.deploy payload: `ok` for a live core,
 * `warn` for a machine whose architecture has no fenced core, and `error`
 * for a plain failure or an RPC throw.
 */
export declare function coreToneOf(view: CoreStatusPayload): CoreTone;
/** The registers page component: machine list + shared form. */
export declare function RemoteWorkspaceSettingsPage({ rpc, t: tSeat }: SettingsInjected & Partial<SettingsOwnerProps>): ReactNode;
export default RemoteWorkspaceSettingsPage;
