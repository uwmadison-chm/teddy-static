interface TeddyConfig {
    apiUrl: string;
    debug: boolean;
    nextUrlHosts: string[];
}

declare global {
    interface Window {
        TEDDY_CONFIG?: Partial<TeddyConfig>;
    }
}

const fileConfig = window.TEDDY_CONFIG || {};

// debug comes only from config.js. A URL parameter would let anyone with a link
// turn off uploads for their session without anything on screen saying so.
export const Config: TeddyConfig = {
    apiUrl: fileConfig.apiUrl || "",
    debug: !!fileConfig.debug,
    nextUrlHosts: fileConfig.nextUrlHosts || [],
};

if (Config.debug) {
    console.log("Debug mode: uploads are disabled");
} else if (!Config.apiUrl) {
    console.error("No apiUrl set in config.js; uploads will fail");
}

export function apiEndpoint(path: string): string {
    return new URL(path, Config.apiUrl).toString();
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
