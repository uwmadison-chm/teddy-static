import type { TaskParameters } from "./types.ts";
export declare const DEFAULT_TIMEOUT_MS = 15000;
export type Outcome = {
    ok: true;
    status: number;
    body: any;
} | {
    ok: false;
    retry: boolean;
    status: number;
    body?: any;
    message: string;
};
export type Http = ReturnType<typeof makeHttp>;
export declare function makeHttp({ fetch, XHR, timeoutMs, }?: {
    fetch?: typeof globalThis.fetch;
    XHR?: typeof XMLHttpRequest;
    timeoutMs?: number;
}): {
    /**
     * GET /task/{task}. With `waitMs`, gives up sooner than usual: a participant is
     * waiting on this one, and saved settings will do if the network is slow.
     */
    taskSettings(server: string, task: string, waitMs?: number): Promise<Outcome>;
    /** POST /task/{task}/run. `waitMs` as for taskSettings. */
    startRun(server: string, task: string, parameters: TaskParameters, waitMs?: number): Promise<Outcome>;
    /**
     * POST /task/{task}/run/{run_id}, with a body already turned into JSON.
     * The body is built from the exact strings stored in the queue, so a retry sends
     * the same bytes as the first try did.
     */
    sendEvents(server: string, task: string, runId: string, jsonBody: string): Promise<Outcome>;
    /** POST /task/{task}/run/{run_id}/media, with the body already turned into JSON. */
    startMedia(server: string, task: string, runId: string, jsonBody: string): Promise<Outcome>;
    /** PUT /task/{task}/run/{run_id}/media/{media_id}/{part} */
    sendPart(server: string, task: string, runId: string, mediaId: number, part: number, blob: Blob, onProgress?: (sentBytes: number) => void): Promise<Outcome>;
    /** POST /task/{task}/run/{run_id}/media/{media_id}/finish */
    finishMedia(server: string, task: string, runId: string, mediaId: number, parts: number): Promise<Outcome>;
    /** POST /task/{task}/run/{run_id}/finalize */
    finalize(server: string, task: string, runId: string): Promise<Outcome>;
};
