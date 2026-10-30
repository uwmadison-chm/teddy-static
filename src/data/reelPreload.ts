// Downloads the session's reels while the participant works through the
// earlier screens, so each one plays at once when its turn comes.
//
// A <video preload="auto"> isn't enough for this: iOS Safari ignores preload,
// Chrome stops buffering a paused video after a while, and data saver turns it
// off. So each reel is fetched whole, one at a time, and played from a blob URL
// once it's in. A reel that isn't in by the time it plays is streamed as
// before.

import {reels} from "virtual:teddy-study";
import {CurrentSessionData, errorFields} from "@/data/sessionData.tsx";
import {ModuleNames} from "@/data/links.ts";

type Preload = {controller: AbortController, blobURL?: string, done: boolean};

// By reel URL, so a file two IDs share is fetched once.
const preloads = new Map<string, Preload>();

// Starts downloading every reel the session's link names, in the order they'll
// play. Does nothing for a link with problems, which never reaches the reels.
export function preloadReels(): void {
    if (CurrentSessionData.linkProblems.length) {
        return;
    }
    const ids = CurrentSessionData.modules
        .filter((m) => m.module == ModuleNames.Reels)
        .flatMap((m) => m.args);
    const queue = ids.filter((id, i) => ids.findIndex((other) => reels[other].url == reels[id].url) == i);
    for (const id of queue) {
        preloads.set(reels[id].url, {controller: new AbortController(), done: false});
    }
    void (async () => {
        for (const id of queue) {
            await preloadReel(id);
        }
    })();
}

async function preloadReel(id: string): Promise<void> {
    const url = reels[id].url;
    const preload = preloads.get(url)!;
    if (preload.controller.signal.aborted) {
        return;
    }
    const started = performance.now();
    try {
        const response = await fetch(url, {signal: preload.controller.signal, priority: "low"});
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        preload.blobURL = URL.createObjectURL(blob);
        CurrentSessionData.logEvent("reel_preloaded", {
            item: id,
            bytes: blob.size,
            seconds: Math.round(performance.now() - started) / 1000,
        });
    } catch (error) {
        if (!preload.controller.signal.aborted) {
            CurrentSessionData.logEvent("reel_preload_failed", {item: id, ...errorFields(error)});
        }
    } finally {
        preload.done = true;
    }
}

// Whether reel `id` is waiting for or in the middle of its download.
export function isPreloading(id: string): boolean {
    const preload = preloads.get(reels[id].url);
    return !!preload && !preload.done && !preload.controller.signal.aborted;
}

// Where to play reel `id` from: its downloaded copy if it's in, or else its
// URL. Stops a download still running for it, since the video will fetch the
// file itself.
export function reelSource(id: string): {src: string, preloaded: boolean} {
    const url = reels[id].url;
    const preload = preloads.get(url);
    if (preload?.blobURL) {
        return {src: preload.blobURL, preloaded: true};
    }
    preload?.controller.abort();
    return {src: url, preloaded: false};
}
