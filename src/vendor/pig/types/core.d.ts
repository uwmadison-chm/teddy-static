import type { Http } from "./http.ts";
import { PigError } from "./shared.ts";
import type { Store } from "./store.ts";
import type { ClientInfo, LogLevel, Notice, Pending, RunRecord, RunSummary, Stamp, TaskParameters } from "./types.ts";
export { PigError };
export declare const DEFAULTS: {
    firstRetryMs: number;
    maxRetryMs: number;
    maxBatchEvents: number;
    maxBatchBytes: number;
    abandonedAfterMs: number;
    heartbeatMs: number;
    sweepMs: number;
    resumeWaitMs: number;
    startWaitMs: number;
};
export type Timing = typeof DEFAULTS;
/** The part of Web Locks the client uses. */
export interface Locks {
    request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown>;
}
export declare class Core {
    #private;
    store: Store;
    http: Http;
    locks: Locks;
    /** Tells the page about progress and errors. */
    notify: (message: Notice) => void;
    log: (level: LogLevel, ...parts: unknown[]) => void;
    options: Timing;
    /** Runs this page holds the lock for: run ID → function that lets go of it. */
    held: Map<string, () => void>;
    /** Runs with a sender working on them. */
    senders: Map<string, Sender>;
    /** Runs this page is sending for only because their own page is gone. */
    orphans: Set<string>;
    /** Each run's calls, so they're handled one at a time: run ID → the latest one. */
    chains: Map<string, Promise<unknown>>;
    /** Callers waiting for a run's queue to empty: run ID → [resolve] */
    sentWaiters: Map<string, (() => void)[]>;
    timers: ReturnType<typeof setInterval>[];
    closed: boolean;
    constructor({ store, http, locks, notify, log, options, }: {
        store: Store;
        http: Http;
        locks: Locks;
        notify?: (message: Notice) => void;
        log?: (level: LogLevel, ...parts: unknown[]) => void;
        options?: Partial<Timing>;
    });
    /** Start the background work: looking for orphaned runs, now and every so often. */
    begin(): Promise<void>;
    /** Stop everything and let go of every run. Used by the tests. */
    close(): Promise<void>;
    /**
     * Start a run. When the server can be reached, the server run is started before this
     * returns, so a closed task or a bad link fails here, where the task can tell the
     * participant. Offline, the run starts locally and the server run starts later.
     *
     * `clientInfo` is what the page knows about itself, for the first event; `stamp` is
     * when start() was called.
     */
    start({ server, task, parameters, finalizeWhenAbandoned, clientInfo, stamp, }: {
        server: string;
        task: string;
        parameters: TaskParameters;
        finalizeWhenAbandoned?: boolean;
        clientInfo: ClientInfo;
        stamp: Stamp;
    }): Promise<RunSummary>;
    /**
     * Pick up a run this page or an earlier one started. Waits a few seconds for another
     * page to let go of it, which is what happens while a task moves between pages.
     */
    resume(id: string): Promise<RunSummary>;
    /**
     * Queue an event. Resolves with its event ID once it's stored in IndexedDB. `stamp` is
     * taken on the page when add() was called.
     */
    add(id: string, data: unknown, stamp: Stamp): Promise<string>;
    /** Queue the finalize. It's sent after everything queued before it. */
    finalize(id: string): Promise<void>;
    /**
     * Resolves once nothing is queued for this run, including anything added before this
     * was called. Never rejects; it just waits.
     */
    sent(id: string): Promise<void>;
    /**
     * Start a media item: an event with bytes attached. Queues the event, and resolves
     * with its event ID, which names the item from then on.
     */
    startMedia(id: string, data: unknown, stamp: Stamp): Promise<string>;
    /**
     * Queue a media item's bytes. A blob bigger than the task's largest part is cut into
     * several parts. Resolves with the part numbers it was given, once they're stored.
     */
    addMedia(id: string, eventId: string, blob: unknown): Promise<number[]>;
    /** Queue a media item's finish, with the number of parts it was given. */
    finishMedia(id: string, eventId: string): Promise<void>;
    /**
     * How much is waiting to be sent: for one run, for one task, or for everything on
     * this device. `bytes` includes media. `failed` counts events and media parts the
     * server refused for good; they're kept, but never sent. `runs` counts runs with anything left to send.
     */
    pending({ run, task }?: {
        run?: string;
        task?: string;
    }): Promise<Pending>;
    /** Throw away every event and media part the server refused for good. */
    discardFailed(): Promise<void>;
    /** Something changed that might let a waiting sender succeed: try again now. */
    nudge(): void;
    /**
     * Look for runs no page is holding, and finish what they left behind: send anything
     * still queued, and finalize the ones that asked for it once they're abandoned.
     * Also forgets runs with nothing left to send whose server run has certainly expired.
     */
    sweep(): Promise<void>;
    /** What the page gets to know about a run. */
    summary(run: RunRecord): RunSummary;
}
/**
 * How a run's sender waits. Two kinds of waiting: idle, with nothing to send, until
 * there's new work; and after a failure, for a while before trying again. New work ends
 * an idle wait but not a failure's, or a server that's down would get a request for every
 * event added. wake() ends either, for when there's reason to think the network is back.
 */
declare class Sender {
    #private;
    idle(): Promise<void>;
    wait(ms: number): Promise<void>;
    newWork(): void;
    wake(): void;
}
