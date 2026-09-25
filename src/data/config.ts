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
const params = new URLSearchParams(window.location.search);

export const Config: TeddyConfig = {
    apiUrl: fileConfig.apiUrl || "",
    debug: !!fileConfig.debug || params.get("debug") == "1",
};

if (Config.debug) {
    console.log("Debug mode: uploads are disabled");
} else if (!Config.apiUrl) {
    console.error("No apiUrl set in config.js; uploads will fail");
}

export function apiEndpoint(path: string): string {
    return new URL(path, Config.apiUrl).toString();
}
