import type { Timing } from "./core.ts";
import { PigError } from "./shared.ts";
import type { Notice, Pending, RunState, RunSummary, TaskParameters } from "./types.ts";
import { CLIENT_VERSION } from "./version.ts";
export { CLIENT_VERSION as version, PigError };
export type { Pending, RunState, TaskParameters };
/**
 * Everything the client tells you about, whichever run it's about: `error`, `progress`,
 * and `run` (a run's server run ID or state changed). Each run also has its own.
 */
export declare const events: EventTarget;
export interface ConnectOptions {
    /** Where pig-worker.js is. Defaults to next to this file. */
    workerUrl?: string | URL;
    /** Shorter waits than usual. For the client's own tests. */
    timing?: Partial<Timing>;
}
export interface StartOptions {
    /** For tasks with no natural end. See README.md. */
    finalizeWhenAbandoned?: boolean;
}
/** Anything with a query string: a URL, a string, or `window.location`. */
export type URLike = URL | Location | string;
/**
 * Set the client up. You don't have to call this: start() and the others do it the
 * first time. Call it yourself, before anything else, to load the worker from somewhere
 * other than next to this file.
 */
export declare function connect(options?: ConnectOptions): void;
/**
 * Whether this browser can run the client. Logs what's missing, if anything. Worth
 * checking before the participant starts, so you can tell them to use another browser
 * rather than lose their data.
 */
export declare function supported(): Promise<boolean>;
/**
 * Start a run of `task` for the participant `parameters` describe.
 *
 * `server` is Pig's address, like "https://pig.yourlab.edu". `parameters` is every name
 * and value the task should start the run with, like { participant_id: "10351" }; Pig
 * records any it doesn't need. To take them from the page's address, use startForURL().
 */
export declare function start(server: string, task: string, parameters: TaskParameters, options?: StartOptions): Promise<Run>;
/**
 * Start a run with the parameters in a URL's query string: every one of them, as it
 * is. Usually `startForURL(server, task, window.location)`.
 */
export declare function startForURL(server: string, task: string, url: URLike, options?: StartOptions): Promise<Run>;
/**
 * Pick up a run started on an earlier page. Keep `run.id` somewhere that survives the
 * page change (sessionStorage is the usual place) and pass it here.
 */
export declare function resume(id: string): Promise<Run>;
/**
 * How much is waiting to be sent. With no argument, for everything on this device; or
 * pass `{ task }` or `{ run }` (a run's id).
 */
export declare function pending(which?: {
    task?: string;
    run?: string;
}): Promise<Pending>;
/**
 * Throw away every event the server refused for good. Those events are kept until you
 * call this, and counted as `failed` in pending().
 */
export declare function discardFailed(): Promise<void>;
/** The client's recent log lines, newest last. */
export declare function debugLog(): string[];
/** One run. Get one from start(), startForURL(), or resume(). */
export declare class Run extends EventTarget {
    #private;
    /** This run's ID on this device. Keep it to resume() the run on another page. */
    readonly id: string;
    readonly task: string;
    /** The server's run ID, or null until the server run has started. */
    runId: string | null;
    /** Which time this is for this participant, or null until the server run has started. */
    runNumber: number | null;
    state: RunState;
    constructor(connection: Connection, summary: RunSummary);
    /** @internal */
    update(summary: RunSummary): void;
    /**
     * Queue an event. Returns at once; the promise resolves with the event's ID once it's
     * safely stored on this device, and rejects if it couldn't be. Await it if you want to
     * know; don't if you'd rather not wait. A failure is also reported as an `error`
     * event on the run either way.
     *
     * `data` is anything that can be turned into JSON, except a field called _client.
     */
    add(data: Record<string, unknown>): Promise<string>;
    /**
     * Start a media item: a recording, an image, or any other file. It's an event like
     * any other, with `data` stored the same way, and bytes attached with the item's
     * add(). Record the content type in `data`; nothing else knows how to play it.
     * Resolves once the event is stored on this device. Refused if the task isn't set
     * up to take media.
     */
    startMedia(data: Record<string, unknown>): Promise<Media>;
    /**
     * Record from a MediaRecorder into a new media item. Starts the recorder itself, with
     * `timeslice` (milliseconds between blobs), and stamps the item with the moment the
     * recorder says it started, on the same clock as every event's `_client`. Sends each
     * blob as it comes, and finishes the item when the recorder stops. Stop it with the
     * item's stop(), or the recorder's own. `data` is stored as the item's event, with
     * `content_type` filled in from the recorder unless you give one. Resolves once the
     * item's event is stored.
     */
    record(recorder: MediaRecorder, data?: Record<string, unknown>, { timeslice }?: {
        timeslice?: number | undefined;
    }): Promise<Media>;
    /**
     * Finalize the run, after everything already added. Resolves once that's queued. Stops
     * any recording record() started and waits for its last blob, which a finalize queued
     * first would refuse.
     */
    finalize(): Promise<void>;
    /**
     * Resolves once everything queued for this run has reached the server. Waits as long
     * as that takes, including while offline.
     */
    sent(): Promise<void>;
    /** How much of this run is still waiting to be sent. */
    pending(): Promise<Pending>;
}
/** One media item. Get one from run.startMedia() or run.record(). */
export declare class Media {
    #private;
    /** The item's event ID, the one its start was stored under. */
    readonly eventId: string;
    /** @internal */
    constructor(connection: Connection, run: string, eventId: string, recording?: Recording);
    /**
     * Queue some of the item's bytes. Returns at once, like run.add(); the promise
     * resolves once they're stored on this device, with the part numbers they were
     * given. Parts are numbered in the order you call this, so the stored parts join
     * back together in that order. A blob too big for one part becomes several.
     */
    add(blob: Blob): Promise<number[]>;
    /** Say the item is complete. Resolves once that's queued, after everything added. */
    finish(): Promise<void>;
    /**
     * For an item from run.record(): stop the recorder. Resolves once its last blob and
     * the item's finish are queued.
     */
    stop(): Promise<void>;
}
/** A recorder record() is running, and when the item it's recording into is finished. */
interface Recording {
    recorder: MediaRecorder;
    finished: Promise<void>;
}
/** The page's end of the worker. */
declare class Connection {
    #private;
    logLines: string[];
    calls: Map<number, {
        resolve: (value: unknown) => void;
        reject: (error: PigError) => void;
    }>;
    nextCall: number;
    /** Runs this page has a Run object for: id → Run */
    runs: Map<string, Run>;
    worker: Worker;
    ready: Promise<unknown>;
    constructor({ workerUrl, timing }: ConnectOptions);
    call(method: string, ...args: unknown[]): Promise<unknown>;
    runFor(summary: RunSummary): Run;
    /** Tell the task about something, on the run it's about and on `events`. */
    report(notice: Notice): void;
}
