// The study Teddy was built with; see vite-plugin-study.ts.
declare module "virtual:teddy-study" {
    // One row of a module's CSV, keyed by column. Columns past the required ones
    // come along as they are.
    export interface StudyItem {
        id: string;
        [column: string]: string;
    }

    export interface TextItem extends StudyItem {
        text: string;
    }

    export interface ReelItem extends StudyItem {
        file: string;
        // Where the reel plays from.
        url: string;
    }

    export const config: Partial<{
        pigServer: string;
        taskCode: string;
        debug: boolean;
        nextUrlHosts: string[];
        recording: Partial<{
            mimeTypes: string[];
            videoBitsPerSecond: number;
            audioBitsPerSecond: number;
            width: number;
            height: number;
            frameRate: number;
        }>;
    }>;
    // The modules this build has, by name.
    export const modules: string[];
    // Items by ID; empty for a module the build doesn't have.
    export const sentences: Record<string, TextItem>;
    export const videoLogPrompts: Record<string, TextItem>;
    export const reels: Record<string, ReelItem>;
}
