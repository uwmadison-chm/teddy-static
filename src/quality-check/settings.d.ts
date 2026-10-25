// The quality-check page's settings; see vite-plugin-quality-check.ts and
// quality-check/settings.js.
declare module "virtual:quality-check-settings" {
    export interface Format {
        label: string;
        mimeType: string;
    }

    export interface Size {
        label: string;
        width: number;
        height: number;
    }

    export const settings: {
        pigServer: string;
        taskCode: string;
        debug: boolean;
        formats: Format[];
        bitrates: number[];
        sizes: Size[];
        frameRate: number;
        audioBitsPerSecond: number;
        maxSeconds: number;
        prompts: string[];
    };

    export const build: {
        teddy: {version: string, commit: string | null, dirty: boolean | null};
    };
}
