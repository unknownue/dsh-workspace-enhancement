/**
 * REQ-I5 / ADR-0024: framed-RPC client over a duplex (SSH exec channel or a
 * local pipe). Multiplexes requests by numeric id and fans spawn events to
 * per-job listeners.
 *
 * @module dsh-workspace-enhancement/core-client
 */
import type { Readable, Writable } from 'node:stream';
import { CORE_EVENTS, type CoreErrorBody, type CoreHelloOk } from './core-protocol.ts';
export declare class CoreRpcError extends Error {
    readonly code: string;
    constructor(body: CoreErrorBody);
}
export interface CoreEventSink {
    (method: string, params: unknown): void;
}
/**
 * One live RPC session. The caller owns the streams (SSH exec channel or a
 * fake duplex); this class only frames and demuxes.
 */
export interface CoreClientOptions {
    /** Latest stderr text from the exec channel (jail diagnostics). */
    stderrOf?: () => string;
}
export declare class CoreClient {
    private readonly stdin;
    private readonly stdout;
    private readonly options;
    private nextId;
    private rest;
    private readonly pending;
    private readonly events;
    private readonly activitySinks;
    private readonly closeSinks;
    private closed;
    private closeNotified;
    private helloCache;
    constructor(stdin: Writable, stdout: Readable, options?: CoreClientOptions);
    private stdoutClosedMessage;
    /** Subscribe to id=0 events (spawn stdout/stderr/exit). */
    onEvent(sink: CoreEventSink): () => void;
    /** Fired on every outbound RPC (idle accounting). */
    onActivity(sink: () => void): () => void;
    /** Fired once when the duplex dies or {@link close} runs. */
    onClose(sink: () => void): () => void;
    /**
     * Cached hello, or a fresh round-trip. Settings/status pass `{ cached: false }`
     * so a stale cache cannot look like a live process (ADR-0024 §6.1).
     */
    hello(signal?: AbortSignal, opts?: {
        cached?: boolean;
    }): Promise<CoreHelloOk>;
    /**
     * Send one request and wait for the matching response.
     * Events (id 0) never settle this promise.
     */
    call(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
    /** End the stdin side; pending calls fail. */
    close(): void;
    private onData;
    private dispatch;
    private failAll;
    private notifyClosed;
}
export { CORE_EVENTS };
