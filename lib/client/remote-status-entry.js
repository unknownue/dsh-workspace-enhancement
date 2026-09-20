import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The header-action VIEW of the remote-status entry (REQ-I2 entry point). All
 * judgments live in `./remote-status.ts` — this file only renders them, because
 * the sandbox runner never executes `.tsx`.
 *
 * One row in the session header action strip: the tri-state state of the
 * connection the current session's cwd routes to (dot + state label), plus a
 * click that re-checks and reconnects. A local session renders nothing at all —
 * the strip stays exactly as upstream built it.
 * @module dsh-workspace-enhancement/client/remote-status-entry
 */
import { useEffect, useState } from 'react';
import { remoteConnectionIdOf } from "./remote-status.js";
import { CONN_STATE_LABEL_KEY, getStatusCenter, useConnStatus, zhBaseline } from "./status.js";
import { ServerIcon } from "./icons.js";
import styles from './status.module.css';
/**
 * Track the session's facts across feed changes. The seat functions are stable
 * across renders (apply builds them once), so the subscription is not
 * re-created; the value guard keeps a feed that fires without a real change
 * from churning renders.
 */
function useRemoteFacts(sessionId, seats) {
    const { remoteFacts, subscribeRemote } = seats;
    const [facts, setFacts] = useState(() => remoteFacts(sessionId));
    useEffect(() => {
        const sync = () => {
            const next = remoteFacts(sessionId);
            setFacts(prev => (prev?.cwd === next?.cwd ? prev : next));
        };
        sync();
        return subscribeRemote(sync);
    }, [sessionId, remoteFacts, subscribeRemote]);
    return facts;
}
/** The remote-status row: dot + state label, click = re-check and reconnect. */
export function RemoteStatusAction(props) {
    const t = props.t ?? zhBaseline;
    const facts = useRemoteFacts(props.sessionId, props);
    const connId = remoteConnectionIdOf(facts?.cwd);
    // Hooks stay unconditional: the status hook is fed the (possibly undefined)
    // connection and returns an unknown view while there is none.
    const center = getStatusCenter(props.rpc, () => t);
    const { view, busy, reconnect } = useConnStatus(center, connId);
    if (connId === undefined)
        return null;
    const state = view?.state ?? 'unknown';
    const machine = view !== null && view.label !== '' ? view.label : connId;
    const dotClass = `${styles.dot} ${state === 'active' ? styles.dotActive : state === 'offline' ? styles.dotOffline : styles.dotUnknown}`;
    return (_jsxs("button", { type: "button", "data-dsw-remote-status": connId, 
        // The global class stays: it is the DOM contract the UAT scripts and the
        // row-badge layer select on. `styles.statusChip` supplies the look.
        className: `dsw-remote-status ${styles.statusChip}`, title: t('header.remote.title', { machine }), "aria-label": t('header.remote.label'), disabled: busy, onClick: () => { void reconnect(); }, children: [_jsx(ServerIcon, { className: styles.statusChipIcon, width: 13, height: 13 }), _jsx("span", { className: dotClass, "aria-hidden": true }), _jsx("span", { className: busy ? `${styles.label} ${styles.labelBusy}` : styles.label, children: busy ? t('status.checking') : t(CONN_STATE_LABEL_KEY[state]) })] }));
}
//# sourceMappingURL=remote-status-entry.js.map