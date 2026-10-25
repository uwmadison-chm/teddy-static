// The quality check's state that every event carries, and where events go.

import {setEventSink, type Level} from "@/data/log.ts";
import {sendEvent} from "@/quality-check/pig.ts";

// The version of the quality check's events, described in the README's
// "Quality check" section.
export const QC_EVENT_SCHEMA = "1.0";

export const session = {
    // Each time the tester picks settings and records with them is a round,
    // numbered from 1.
    round: 0,
    // The recording running now, numbered from 1 within the visit, if any.
    recording: null as number | null,
    recordings: 0,
};

// Every event says which round and recording it happened in, like Teddy's say
// which module and recording.
export function logEvent(type: string, fields: Record<string, unknown> = {}, level: Level = "info"): void {
    sendEvent({type, level, module: "quality_check", round: session.round || null, recording: session.recording, ...fields});
}

setEventSink(logEvent);

// What the tester typed as their ID, cut down to what pig can use in a path:
// letters, digits, underscore and dash.
export function cleanTesterID(raw: string): string {
    return raw.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}
