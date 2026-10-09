interface TeddyConfig {
    apiUrl: string;
    debug: boolean;
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
};

if (Config.debug) {
    console.log("Debug mode: uploads are disabled");
} else if (!Config.apiUrl) {
    console.error("No apiUrl set in config.js; uploads will fail");
}

export function apiEndpoint(path: string): string {
    return new URL(path, Config.apiUrl).toString();
}
