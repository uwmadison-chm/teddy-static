// Downloads the calibration chime as soon as the page has loaded, so it plays
// at once when Teddy says "like this:". iOS Safari won't buffer an <audio>
// until it's played, so we fetch it whole and play it from a blob URL, like
// the reels.

import chimeUrl from "@/assets/audio/timer_complete.mp3";
import {CurrentSessionData, errorFields} from "@/data/sessionData.tsx";

let blobURL: string | undefined;

export async function preloadChime(): Promise<void> {
    try {
        const response = await fetch(chimeUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        blobURL = URL.createObjectURL(await response.blob());
    } catch (error) {
        CurrentSessionData.logEvent("chime_preload_failed", errorFields(error));
    }
}

// Where to play the chime from: its downloaded copy if it's in, or else its URL.
export function chimeSource(): string {
    return blobURL ?? chimeUrl;
}
