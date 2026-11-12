// Everything Teddy sends to pig goes through here.
//
// pig's client (@uwmadison-chm/pig-client) keeps each event and recording on the device
// until pig confirms it has it, and sends them as soon as it can. This file starts
// the session's run, and in debug mode skips pig entirely and logs to the console
// instead.

import * as pig from "@uwmadison-chm/pig-client";
import {Config} from "@/data/config.ts";
import {forgetSession, type SavedSession, savedSession} from "@/data/revisit.ts";
// Vite copies the worker into the build and gives us its URL.
import workerUrl from "@uwmadison-chm/pig-client/pig-worker.js?url";

export type Pending = pig.Pending;

// How many milliseconds of recording each part holds. A tab closed partway
// through a recording loses at most this much.
const RECORDING_TIMESLICE = 5000;

let run: pig.Run | null = null;
// Events added before the run has started. Sent, in order, once it has.
let waiting: Record<string, unknown>[] = [];

// Why the run couldn't start, for the screen that tells the participant.
export interface StartFailure {
    // "offline", "task-closed", "unsupported", or any other PigError code
    code: string;
    message: string;
}

// How the run started: picked back up from an earlier visit (see revisit.ts),
// or new, and if new when there was one to pick up, why that didn't work.
export interface RunOutcome {
    resumed: SavedSession | null;
    // The PigError code resume() threw, like "finished" or "busy".
    resumeFailed: string | null;
}

// Makes the run's first event, once it's known how the run started.
let opening: ((outcome: RunOutcome) => Record<string, unknown>) | null = null;

export function setOpeningEvent(make: (outcome: RunOutcome) => Record<string, unknown>): void {
    opening = make;
}

let started: Promise<StartFailure | null> | null = null;
// Set once finishRun() has finalized the run.
let finishing: Promise<void> | null = null;

// Starts this session's run, once. Resolves with null when it started (or in
// debug mode), or with what went wrong. Call it as early as possible: a bad
// link or a closed task shows up here, before the participant does anything.
export function startRun(): Promise<StartFailure | null> {
    started ??= start();
    return started;
}

async function start(): Promise<StartFailure | null> {
    const saved = savedSession();
    if (Config.debug) {
        // There's no run to resume, but the session can still go back to its module.
        const data = opening?.({resumed: saved, resumeFailed: null});
        if (data) {
            console.log("Debug mode: event", data);
        }
        return null;
    }
    const outcome: RunOutcome = {resumed: null, resumeFailed: null};
    try {
        pig.connect({workerUrl: new URL(workerUrl, document.baseURI)});
        if (!(await pig.supported())) {
            return {code: "unsupported", message: "This browser can't store data the way Teddy needs."};
        }
        if (saved?.runId) {
            try {
                run = await pig.resume(saved.runId);
                outcome.resumed = saved;
            } catch (error) {
                // Finalized, gone from this device, or open in another tab.
                console.warn("Couldn't resume the run; starting a new one:", error);
                outcome.resumeFailed = error?.code || "error";
            }
        }
        // Every link parameter goes to pig. pig's task configuration decides which
        // ones identify the run, and records the rest. A run that may be resumed
        // can't be finalized just for sitting idle: pig's expires_after closes it.
        run ??= await pig.startForURL(Config.pigServer, Config.taskCode, window.location, {
            finalizeWhenAbandoned: Config.revisit != "resume",
        });
    } catch (error) {
        console.error("Couldn't start a pig run:", error);
        waiting = [];
        return {code: error?.code || "error", message: error?.message || String(error)};
    }
    run.addEventListener("error", (e: CustomEvent) => {
        console.warn("pig:", e.detail.code, e.detail.message);
    });
    const data = opening?.(outcome);
    if (data) {
        run.add(data);
    }
    for (const data of waiting) {
        run.add(data);
    }
    waiting = [];
    return null;
}

// The run's id on this device, to resume it on a later visit; null before it
// has started, and in debug mode.
export function runId(): string | null {
    return run?.id ?? null;
}

// Queues an event. Returns at once. Once the run is finishing, pig would
// refuse anything more, so later events only go to the console.
export function sendEvent(data: Record<string, unknown>): void {
    if (Config.debug) {
        console.log("Debug mode: event", data);
        return;
    }
    if (finishing != null) {
        console.log("Not sent; the run is finishing:", data);
        return;
    }
    if (run == null) {
        waiting.push(data);
        return;
    }
    run.add(data).catch((error) => {
        console.error("Couldn't store an event:", error, data);
    });
}

// Starts `recorder` and sends what it records to pig as one media item, with
// `data` as the item's event. The item finishes when the recorder stops.
export async function record(recorder: MediaRecorder, data: Record<string, unknown>): Promise<void> {
    if (run == null) {
        if (Config.debug) {
            console.log("Debug mode: recording", data);
        }
        recorder.start(RECORDING_TIMESLICE);
        return;
    }
    await run.record(recorder, data, {timeslice: RECORDING_TIMESLICE});
}

// Finalizes the run, once, and resolves when everything has reached pig. Calls
// `onProgress` as it goes, with what's still to send.
export async function finishRun(onProgress: (pending: Pending) => void): Promise<void> {
    // A visit after this starts a new session.
    forgetSession();
    if (run == null) {
        return;
    }
    const listener = (e: CustomEvent) => onProgress(e.detail.pending);
    run.addEventListener("progress", listener);
    try {
        finishing ??= run.finalize().then(() => run.sent());
        onProgress(await run.pending());
        await finishing;
    } finally {
        run.removeEventListener("progress", listener);
    }
}
