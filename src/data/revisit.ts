// With `revisit: "resume"` in config.js, what a session needs to pick up its
// run again when the participant reloads the page or opens their link again.
//
// It's kept in localStorage, which a new tab shares (reopening a link from a
// text message opens one), keyed by the page and the link's query string, so
// each link picks up only its own session.

import {Config} from "@/data/config.ts";

export interface SavedSession {
    // pig's id for the run on this device; null in debug mode, where there's no run.
    runId: string | null;
    // The module to go back to, as an index into the link's
    // modules; -1 before the first one.
    module: number;
    // True when that's calibration, which runs before the first module.
    calibrating: boolean;
    // How many of that module's items were done: the index of the one to go
    // back to.
    item: number;
    // How many recordings the session has numbered so far.
    recordings: number;
    // When this was saved, in milliseconds since 1970.
    savedAt: number;
}

const KEY = "teddy-session:" + window.location.pathname + window.location.search;

// What an earlier visit with this link saved, if config.js asks for resuming
// and there's anything. Doesn't say whether pig can still resume the run.
export function savedSession(): SavedSession | null {
    if (Config.revisit != "resume") {
        return null;
    }
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
        if (saved == null || typeof saved.module != "number" || typeof saved.recordings != "number" ||
            typeof saved.item != "number") {
            return null;
        }
        return saved as SavedSession;
    } catch {
        return null;
    }
}

// Saves where the session is, when config.js asks for resuming.
export function saveSession(session: Omit<SavedSession, "savedAt">): void {
    if (Config.revisit != "resume") {
        return;
    }
    try {
        window.localStorage.setItem(KEY, JSON.stringify({...session, savedAt: Date.now()}));
    } catch (error) {
        // Private browsing, or storage that's full or turned off. The session
        // goes on; a revisit just starts over.
        console.warn("Couldn't save the session for a revisit:", error);
    }
}

// Forgets the session, once it's over, so the next visit starts a new one.
export function forgetSession(): void {
    try {
        window.localStorage.removeItem(KEY);
    } catch {
        // Nothing was saved, then.
    }
}
