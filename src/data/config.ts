import {config as studyConfig} from "virtual:teddy-study";

interface RecordingConfig {
    // Tried in order; the first one the browser can record is used.
    mimeTypes: string[];
    videoBitsPerSecond: number;
    audioBitsPerSecond: number;
    // What we ask the camera for. The browser gets as close as the camera allows.
    width: number;
    height: number;
    frameRate: number;
    // The longest any one recording can run, so a session left open can't
    // record for hours. A module may stop its recordings sooner.
    maxSeconds: number;
}

interface TeddyConfig {
    pigServer: string;
    taskCode: string;
    debug: boolean;
    nextUrlHosts: string[];
    recording: RecordingConfig;
}

const defaultRecording: RecordingConfig = {
    mimeTypes: ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"],
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 64_000,
    width: 640,
    height: 480,
    frameRate: 30,
    maxSeconds: 600,
};

// The study's config.js, which the build checks (see vite-plugin-study.ts).
// debug comes only from there. A URL parameter would let anyone with a link
// turn off uploads for their session without anything on screen saying so.
export const Config: TeddyConfig = {
    pigServer: studyConfig.pigServer || "",
    taskCode: studyConfig.taskCode || "",
    debug: !!studyConfig.debug,
    nextUrlHosts: studyConfig.nextUrlHosts || [],
    recording: {...defaultRecording, ...studyConfig.recording},
};

if (Config.debug) {
    console.log("Debug mode: uploads are disabled");
}

// nextURL comes from the link, and the end screen sends the participant there.
// Only http(s) URLs are allowed, so a javascript: URL can't run on this site, and
// when nextUrlHosts lists any hosts, only those. Returns null for anything else.
export function allowedNextURL(raw: string | null): string | null {
    if (!raw) {
        return null;
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol != "https:" && url.protocol != "http:") {
        return null;
    }
    if (Config.nextUrlHosts.length && !Config.nextUrlHosts.includes(url.hostname)) {
        return null;
    }
    return url.toString();
}
