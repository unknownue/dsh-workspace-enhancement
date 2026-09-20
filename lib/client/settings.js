import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useState } from 'react';
import { MachineForm } from "./machine-form.js";
import { ConnStatusBadge, zhBaseline } from "./status.js";
import { coreStatusLabel } from "./core-status.js";
import { AlertIcon, CheckIcon, ChevronIcon } from "./icons.js";
import styles from './settings.module.css';
// The control vocabulary (capsule buttons, 32px fields) is owned by the form
// stylesheet, which the editor hosted below already renders with — reusing it
// here is what keeps the row actions and the form actions identical.
import form from './machine-form.module.css';
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Structural check for one machine wire row (unknown fields tolerated). */
function asMachineView(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.id !== 'string' || typeof value.host !== 'string' || typeof value.username !== 'string')
        return null;
    const machine = {
        id: value.id,
        label: typeof value.label === 'string' ? value.label : value.host,
        host: value.host,
        port: typeof value.port === 'number' ? value.port : 22,
        username: value.username,
        auth: value.auth === 'password' || value.auth === 'agent' ? value.auth : 'key',
        passwordSet: value.passwordSet === true,
        jumpHosts: Array.isArray(value.jumpHosts) ? value.jumpHosts.map(String) : [],
        credentialBackend: typeof value.credentialBackend === 'string' ? value.credentialBackend : 'plain',
        remoteApproval: value.remoteApproval === 'human' || value.remoteApproval === 'ai' ? value.remoteApproval : 'off',
        remoteSandbox: value.remoteSandbox === 'read-only' || value.remoteSandbox === 'workspace-write' ? value.remoteSandbox : 'off',
    };
    if (typeof value.cwd === 'string')
        machine.cwd = value.cwd;
    if (typeof value.workspace === 'string')
        machine.workspace = value.workspace;
    if (value.hostKeyMode === 'accept-new' || value.hostKeyMode === 'verify' || value.hostKeyMode === 'off') {
        machine.hostKeyMode = value.hostKeyMode;
    }
    if (value.encryptFallback === true)
        machine.encryptFallback = true;
    if (Array.isArray(value.recentWorkspaces))
        machine.recentWorkspaces = value.recentWorkspaces.map(String);
    return machine;
}
/** Unwrap a wire result or throw its business error. */
function unwrap(result, fallback) {
    if (!result.ok)
        throw new Error(result.error.message || fallback);
    return result.value;
}
/** Map a machine row onto the shared form's edit initial state (secret-free). */
function editInitialOf(machine) {
    return {
        id: machine.id,
        name: machine.label,
        host: machine.host,
        port: String(machine.port || 22),
        username: machine.username || 'root',
        workspace: machine.workspace ?? machine.cwd ?? '',
        hostKeyMode: machine.hostKeyMode ?? '',
        encryptPassword: machine.credentialBackend !== '' && machine.credentialBackend !== 'plain',
        remoteApproval: machine.remoteApproval ?? 'off',
        remoteSandbox: machine.remoteSandbox ?? 'off',
        auth: machine.auth === 'password'
            || machine.passwordSet === true
            || (machine.credentialBackend !== '' && machine.credentialBackend !== 'plain')
            ? 'password'
            : 'key',
        jumpText: machine.jumpHosts.join(', '),
    };
}
/**
 * F2: the durable save acknowledgment. The machine form's success text cannot
 * persist — the form remounts when `key={editing?.id}` changes and any in-form
 * feedback vanishes with it — so the settings page owns the banner. The
 * honest fallback marker (encryption requested, OS backend failed) rides
 * along as pure text (no live data; a `MachineSaveView` leaf).
 */
export function savedBanner(view, t = zhBaseline) {
    const label = view.label || `${view.username}@${view.host}`;
    const fallback = view.encryptFallback === true ? t('settings.encrypt.fallback') : '';
    return t('settings.saved', { label, fallback });
}
/**
 * Tone of a core.status / core.deploy payload: `ok` for a live core,
 * `warn` for a machine whose architecture has no fenced core, and `error`
 * for a plain failure or an RPC throw.
 */
export function coreToneOf(view) {
    if (view.ok === true)
        return 'ok';
    const detail = typeof view.detail === 'string' ? view.detail : '';
    return /linux|x86_64|amd64|uname/i.test(detail) ? 'warn' : 'error';
}
const CORE_TONE_CLASS = {
    ok: styles.coreChipOk,
    warn: styles.coreChipWarn,
    error: styles.coreChipError,
};
/** The registers page component: machine list + shared form. */
export function RemoteWorkspaceSettingsPage({ rpc, t: tSeat }) {
    const t = tSeat ?? zhBaseline;
    const [machines, setMachines] = useState([]);
    const [currentId, setCurrentId] = useState('');
    const [editing, setEditing] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [coreLines, setCoreLines] = useState({});
    const [moreOpen, setMoreOpen] = useState('');
    const refresh = async () => {
        try {
            const result = await rpc('machines.list');
            const state = unwrap(result, t('settings.rpc.listMachines'));
            setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
            setCurrentId(typeof state.currentId === 'string' ? state.currentId : '');
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
    };
    useEffect(() => { void refresh(); }, []);
    const startEdit = (machine) => {
        setEditing(editInitialOf(machine));
        setErr('');
        setMsg('');
    };
    const del = async (id) => {
        if (!window.confirm(t('settings.delete.confirm')))
            return;
        setBusy(true);
        setErr('');
        setMsg('');
        setMoreOpen('');
        try {
            const result = await rpc('machines.remove', { id });
            const state = unwrap(result, t('settings.rpc.removeFailed'));
            setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
            setCurrentId(typeof state.currentId === 'string' ? state.currentId : '');
            if (editing?.id === id)
                setEditing(null);
            setMsg(t('settings.deleted'));
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const useNow = async (id) => {
        setBusy(true);
        setErr('');
        setMsg('');
        setMoreOpen('');
        try {
            const result = await rpc('machines.setCurrent', { id });
            const state = unwrap(result, t('settings.rpc.switchFailed'));
            setMachines(Array.isArray(state.machines) ? state.machines.map(asMachineView).filter((m) => m !== null) : []);
            setCurrentId(typeof state.currentId === 'string' ? state.currentId : '');
            setMsg(t('settings.setCurrent'));
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const forgetKey = async (machine) => {
        setBusy(true);
        setErr('');
        setMsg('');
        setMoreOpen('');
        try {
            const result = await rpc('hostkey.forget', { id: machine.id });
            unwrap(result, t('settings.rpc.forgetKeyFailed'));
            setMsg(t('settings.forgotten', { host: machine.host, port: machine.port }));
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const refreshCore = async (id) => {
        setMoreOpen('');
        try {
            const result = await rpc('core.status', { id });
            const view = unwrap(result, t('settings.rpc.coreStatusFailed'));
            setCoreLines(current => ({ ...current, [id]: { label: coreStatusLabel(view, t), tone: coreToneOf(view) } }));
        }
        catch (error) {
            setCoreLines(current => ({
                ...current,
                [id]: { label: error instanceof Error ? error.message : String(error), tone: 'error' },
            }));
        }
    };
    const deployCore = async (id) => {
        setBusy(true);
        setErr('');
        setMsg('');
        setMoreOpen('');
        try {
            const result = await rpc('core.deploy', { id });
            const view = unwrap(result, t('settings.rpc.coreDeployFailed'));
            const line = { label: coreStatusLabel(view, t), tone: coreToneOf(view) };
            setCoreLines(current => ({ ...current, [id]: line }));
            setMsg(line.label);
        }
        catch (error) {
            setErr(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    const handleSaved = (view) => {
        setEditing(null);
        setErr('');
        // F2: the page-level banner is the durable acknowledgment (the in-form
        // prompt is remounted away); it must stay visible after the refresh.
        setMsg(savedBanner(view, t));
        void refresh();
    };
    return (_jsxs("div", { className: styles.section, children: [_jsx("h1", { className: styles.title, children: t('settings.title') }), _jsx("p", { className: styles.intro, children: t('settings.description') }), err !== '' ? (_jsxs("div", { className: `${styles.banner} ${styles.bannerError}`, role: "alert", children: [_jsx(AlertIcon, { className: styles.bannerIcon }), _jsx("span", { children: err })] })) : null, msg !== '' ? (_jsxs("div", { className: `${styles.banner} ${styles.bannerSuccess}`, role: "status", children: [_jsx(CheckIcon, { className: styles.bannerIcon }), _jsx("span", { children: msg })] })) : null, _jsxs("section", { className: styles.group, children: [_jsx("h2", { className: styles.groupTitle, children: t('settings.machines.title') }), machines.length > 0
                        ? (_jsx("ul", { className: styles.rows, children: machines.map(machine => {
                                const isCurrent = machine.id === currentId;
                                const core = coreLines[machine.id];
                                return (_jsxs("li", { className: styles.rowCard, children: [_jsxs("div", { className: styles.rowHead, children: [_jsxs("div", { className: styles.rowIdentity, children: [_jsx("span", { className: styles.rowName, children: machine.label }), machine.credentialBackend !== '' && machine.credentialBackend !== 'plain'
                                                            ? _jsx("span", { className: styles.rowTag, children: t('settings.machines.keychainBadge') })
                                                            : null, machine.jumpHosts.length > 0
                                                            ? _jsx("span", { className: styles.rowTag, children: t('settings.machines.jumpBadge', { count: machine.jumpHosts.length }) })
                                                            : null, isCurrent ? _jsx("span", { className: styles.rowTag, children: t('settings.machines.currentBadge') }) : null] }), _jsxs("div", { className: styles.rowActions, children: [!isCurrent && (_jsx("button", { type: "button", className: `${form.secondaryButton} ${form.small}`, disabled: busy, onClick: () => void useNow(machine.id), children: t('settings.machines.setCurrent') })), _jsx("button", { type: "button", className: `${form.secondaryButton} ${form.small}`, disabled: busy, onClick: () => startEdit(machine), children: t('settings.machines.edit') }), _jsxs("details", { className: styles.more, open: moreOpen === machine.id, onToggle: event => {
                                                                const isOpen = event.currentTarget.open;
                                                                setMoreOpen(current => (isOpen ? machine.id : current === machine.id ? '' : current));
                                                            }, children: [_jsxs("summary", { className: `${form.secondaryButton} ${form.small} ${styles.moreSummary} ${moreOpen === machine.id ? styles.moreSummaryOpen : ''}`, "aria-label": t('settings.machines.more'), children: [t('settings.machines.more'), _jsx(ChevronIcon, { className: styles.moreChevron, width: 12, height: 12 })] }), _jsxs("div", { className: styles.moreMenu, role: "menu", children: [_jsx("button", { type: "button", role: "menuitem", className: styles.moreItem, disabled: busy, onClick: () => void forgetKey(machine), children: t('settings.machines.forgetKey') }), _jsx("button", { type: "button", role: "menuitem", className: styles.moreItem, disabled: busy, onClick: () => void refreshCore(machine.id), children: t('settings.machines.coreStatus') }), _jsx("button", { type: "button", role: "menuitem", className: styles.moreItem, disabled: busy, onClick: () => void deployCore(machine.id), children: t('settings.machines.deployCore') }), _jsx("div", { className: styles.moreSep }), _jsx("button", { type: "button", role: "menuitem", className: `${styles.moreItem} ${styles.moreItemDanger}`, disabled: busy, onClick: () => void del(machine.id), children: t('settings.machines.delete') })] })] })] })] }), _jsxs("div", { className: styles.rowMeta, children: [_jsx(ConnStatusBadge, { id: machine.id, rpc: rpc, t: t }), _jsxs("span", { className: styles.rowEndpoint, children: [machine.username, "@", machine.host, ":", machine.port] }), machine.encryptFallback === true
                                                    ? _jsx("span", { className: `${styles.coreChip} ${styles.coreChipWarn}`, children: t('settings.machines.encryptFallbackBadge') })
                                                    : null, machine.remoteApproval !== 'off'
                                                    ? _jsx("span", { className: styles.coreChip, children: t('settings.machines.gateBadge', { mode: machine.remoteApproval }) })
                                                    : null, core !== undefined
                                                    ? _jsx("span", { className: `${styles.coreChip} ${CORE_TONE_CLASS[core.tone]}`, role: "status", children: core.label })
                                                    : null] })] }, machine.id));
                            }) }))
                        : _jsx("p", { className: styles.empty, children: t('settings.machines.empty') })] }), _jsxs("section", { className: styles.group, children: [_jsx("h2", { className: styles.groupTitle, children: editing !== null ? t('settings.form.editTitle') : t('settings.form.addTitle') }), _jsxs("div", { className: styles.editor, children: [editing !== null
                                ? _jsx("div", { className: styles.editorHead, children: _jsx("span", { className: styles.editorNote, children: t('settings.form.editNote') }) })
                                : null, _jsx(MachineForm, { mode: "settings", rpc: rpc, initial: editing ?? undefined, t: t, onSaved: handleSaved }, editing?.id ?? 'blank')] })] })] }));
}
export default RemoteWorkspaceSettingsPage;
//# sourceMappingURL=settings.js.map