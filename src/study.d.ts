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

    // One choice of a question's responses.
    export interface Choice {
        code: string;
        label: string;
    }

    export interface QuestionItem extends StudyItem {
        text: string;
        // As the CSV has them, in REDCap's format: "1, Not at all | 2, Slightly"
        responses: string;
        choices: Choice[];
    }

    export const config: Partial<{
        pigServer: string;
        taskCode: string;
        debug: boolean;
        nextUrlHosts: string[];
        nextUrlAfterFailure: boolean;
        recording: Partial<{
            mimeTypes: string[];
            videoBitsPerSecond: number;
            audioBitsPerSecond: number;
            width: number;
            height: number;
            frameRate: number;
            maxSeconds: number;
        }>;
    }>;
    // What this build is. Commits and dirty are null outside git.
    export const build: {
        teddy: {version: string, commit: string | null, dirty: boolean | null};
        study: {commit: string | null, dirty: boolean | null, hash: string};
    };
    // The modules this build has, by name.
    export const modules: string[];
    // Items by ID; empty for a module the build doesn't have.
    export const sentences: Record<string, TextItem>;
    export const videoLogPrompts: Record<string, TextItem>;
    export const reels: Record<string, ReelItem>;
    export const questions: Record<string, QuestionItem>;
    // Each module's item IDs in the CSV's order, by module name.
    export const itemIDs: Record<string, string[]>;
}
