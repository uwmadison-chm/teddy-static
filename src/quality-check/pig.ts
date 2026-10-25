// What the quality check sends to pig. Like Teddy's pig.ts, but the run starts
// when the tester has given their ID, with that as its only parameter, and in
// debug mode everything goes to the console.

import * as pig from "@uwmadison-chm/pig-client";
import {settings} from "virtual:quality-check-settings";
// Vite copies the worker into the build and gives us its URL.
import workerUrl from "@uwmadison-chm/pig-client/pig-worker.js?url";

export type Pending = pig.Pending;

// How many milliseconds of recording each part holds.
const RECORDING_TIMESLICE = 5000;

let run: pig.Run | null = null;
// Events from before the run started, sent once it has.
let waiting: Record<string, unknown>[] = [];
let finishing: Promise<void> | null = null;

// Starts a run for `tester`, unless one is going. Resolves with null when it started (or in
// debug mode), or with what went wrong.
export async function startRun(tester: string): Promise<string | null> {
    if (settings.debug || run != null) {
        return null;
    }
    try {
        pig.connect({workerUrl: new URL(workerUrl, document.baseURI)});
        if (!(await pig.supported())) {
            return "This browser can't store data the way pig needs.";
        }
        run = await pig.start(settings.pigServer, settings.taskCode, {tester}, {finalizeWhenAbandoned: true});
    } catch (error) {
        console.error("Couldn't start a pig run:", error);
        return error?.message || String(error);
    }
    for (const data of waiting) {
        run.add(data);
    }
    waiting = [];
    return null;
}

export function sendEvent(data: Record<string, unknown>): void {
    if (settings.debug) {
        console.log("Debug mode: event", data);
    } else if (finishing != null) {
        console.log("Not sent; the run is finishing:", data);
    } else if (run == null) {
        waiting.push(data);
    } else {
        run.add(data).catch((error) => console.error("Couldn't store an event:", error, data));
    }
}

// Starts `recorder`, sending what it records to pig as one media item with
// `data` as its event.
export async function record(recorder: MediaRecorder, data: Record<string, unknown>): Promise<void> {
    if (run == null) {
        console.log("Debug mode: recording", data);
        recorder.start(RECORDING_TIMESLICE);
        return;
    }
    await run.record(recorder, data, {timeslice: RECORDING_TIMESLICE});
}

// Finalizes the run and resolves once everything has reached pig, calling
// `onProgress` with what's left to send as it goes. After that, startRun()
// starts a new one.
export async function finishRun(onProgress: (pending: Pending) => void): Promise<void> {
    if (run == null) {
        return;
    }
    const listener = (e: CustomEvent) => onProgress(e.detail.pending);
    run.addEventListener("progress", listener);
    try {
        finishing ??= run.finalize().then(() => run.sent());
        onProgress(await run.pending());
        await finishing;
        run.removeEventListener("progress", listener);
        run = null;
        finishing = null;
    } catch (error) {
        run.removeEventListener("progress", listener);
        throw error;
    }
}
