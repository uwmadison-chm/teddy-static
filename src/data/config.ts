interface RecordingConfig {
    // Tried in order; the first one the browser can record is used.
    mimeTypes: string[];
    videoBitsPerSecond: number;
    audioBitsPerSecond: number;
    // What we ask the camera for. The browser gets as close as the camera allows.
    width: number;
    height: number;
    frameRate: number;
}

interface TeddyConfig {
    pigServer: string;
    taskCode: string;
    debug: boolean;
    nextUrlHosts: string[];
    recording: RecordingConfig;
}

declare global {
    interface Window {
        TEDDY_CONFIG?: Partial<Omit<TeddyConfig, "recording"> & {recording: Partial<RecordingConfig>}>;
    }
}

const defaultRecording: RecordingConfig = {
    mimeTypes: ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"],
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 64_000,
    width: 640,
    height: 480,
    frameRate: 30,
};

const fileConfig = window.TEDDY_CONFIG || {};

// debug comes only from config.js. A URL parameter would let anyone with a link
// turn off uploads for their session without anything on screen saying so.
export const Config: TeddyConfig = {
    pigServer: fileConfig.pigServer || "",
    taskCode: fileConfig.taskCode || "",
    debug: !!fileConfig.debug,
    nextUrlHosts: fileConfig.nextUrlHosts || [],
    recording: {...defaultRecording, ...fileConfig.recording},
};

if (Config.debug) {
    console.log("Debug mode: uploads are disabled");
} else if (!Config.pigServer || !Config.taskCode) {
    console.error("config.js needs pigServer and taskCode; nothing can be sent without them");
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
