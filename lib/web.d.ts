/**
 * Web-facing RPC channel of dsh-workspace-enhancement: mounts the connection
 * registry and registers the `/dsw` unary channel on the shared web transport.
 * Host/Origin fencing is the connection service's global loopback-and-trusted
 * check, so the channel carries no per-route authority anymore (dropped in
 * `dsh 0.1.5`). The client half drives connection management
 * and remote directory browsing through it; endpoints are plain JSON. Remote
 * listing shares one level walk with the directory-picker backend
 * ({@link module:dsh-workspace-enhancement/listing}).
 * @module dsh-workspace-enhancement/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RegistryConfig } from './registry.ts';
/** Channel config. */
export interface WebChannelConfig extends RegistryConfig {
    /** Complete-result bound of one remote listing level. */
    maxEntries?: number;
}
/** The unary RPC result shape the shared transport expects. */
export type ChannelResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
};
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host connection transport; the shared RPC channel registry lives here. */
        connection: {
            rpc: {
                handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ChannelResult>): () => Promise<void>;
            };
        };
        /**
         * Host HTTP route registry. The connection transport mounts every channel
         * route here, so a channel owner must inject this service (`dsh 0.1.5`;
         * earlier builds read it off the connection service and needed no
         * injection). See {@link mountChannel} for the owning-context subtlety.
         */
        webServer: {
            register(route: {
                kind: 'exact' | 'prefix';
                path: string;
                handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
            }): () => void;
        };
    }
}
/** Required host services: the web transport + the tools/system-prompt registry. */
export declare const inject: string[];
/** Validated channel config. */
export declare const Config: z<WebChannelConfig>;
/**
 * Mount the connection registry and the `/dsw` channel.
 * @param ctx - the mounting Cordis context.
 * @param config - state file and listing bound.
 */
export declare function apply(ctx: Context, config: WebChannelConfig): void;
