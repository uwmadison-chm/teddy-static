// Builds a study into Teddy. A study is a folder holding config.js, a CSV of
// items for each module (sentence.csv, videolog.csv, reels.csv), and the reel
// videos in reels/. TEDDY_STUDY names the folder; it defaults to example-study/.
//
// The app imports all of it from "virtual:teddy-study". Anything wrong with the
// study (a missing setting, a duplicate ID, a reel file that isn't there) stops
// the build, rather than turning up for a participant.

import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdirSync, readFileSync} from "node:fs";
import {dirname, extname, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import Papa from "papaparse";
import {searchForWorkspaceRoot, type Plugin, type ResolvedConfig} from "vite";

const VIRTUAL_ID = "virtual:teddy-study";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

// The settings config.js may have, and the type of each.
const CONFIG_KEYS: Record<string, string> = {
    pigServer: "string",
    taskCode: "string",
    debug: "boolean",
    nextUrlHosts: "string[]",
    recording: "object",
};
const RECORDING_KEYS: Record<string, string> = {
    mimeTypes: "string[]",
    videoBitsPerSecond: "number",
    audioBitsPerSecond: "number",
    width: "number",
    height: "number",
    frameRate: "number",
};

// Each module's CSV and the columns it has to have. Other columns are allowed,
// and come along with each item.
const MODULE_FILES: Record<string, {file: string, columns: string[]}> = {
    sentence: {file: "sentence.csv", columns: ["id", "text"]},
    videolog: {file: "videolog.csv", columns: ["id", "text"]},
    reels: {file: "reels.csv", columns: ["id", "file"]},
};

type Row = Record<string, string>;

class StudyError extends Error {}

function typeOf(value: unknown): string {
    if (Array.isArray(value)) {
        return value.every(x => typeof x == "string") ? "string[]" : "array";
    }
    return value === null ? "null" : typeof value;
}

function checkKeys(where: string, obj: Record<string, unknown>, keys: Record<string, string>, problems: string[]) {
    for (const [key, value] of Object.entries(obj)) {
        if (!(key in keys)) {
            problems.push(`${where}: unknown setting ${key}`);
        } else if (typeOf(value) != keys[key]) {
            problems.push(`${where}: ${key} should be a ${keys[key]}, not ${typeOf(value)}`);
        }
    }
}

async function loadConfig(path: string): Promise<Record<string, unknown>> {
    if (!existsSync(path)) {
        throw new StudyError(`${path} doesn't exist`);
    }
    // The query string makes Node load the file again after it changes.
    const module = await import(pathToFileURL(path).href + "?t=" + Date.now());
    const config = module.default;
    if (typeOf(config) != "object") {
        throw new StudyError(`${path} needs to export default an object of settings`);
    }
    const problems: string[] = [];
    checkKeys("config.js", config, CONFIG_KEYS, problems);
    if (typeOf(config.recording) == "object") {
        checkKeys("config.js recording", config.recording, RECORDING_KEYS, problems);
    }
    if (!config.debug && (!config.pigServer || !config.taskCode)) {
        problems.push("config.js needs pigServer and taskCode unless debug is true");
    }
    if (problems.length) {
        throw new StudyError(problems.join("\n"));
    }
    return config;
}

function loadItems(path: string, columns: string[]): Row[] {
    if (!existsSync(path)) {
        return [];
    }
    // Drop the byte-order mark Excel adds, and mixed line endings from hand edits.
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const parsed = Papa.parse<Row>(text, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: h => h.trim(),
    });
    const problems = parsed.errors.map(e => `${path} row ${(e.row ?? 0) + 2}: ${e.message}`);
    const headers = parsed.meta.fields || [];
    for (const column of columns) {
        if (!headers.includes(column)) {
            problems.push(`${path} needs a ${column} column`);
        }
    }
    if (problems.length) {
        throw new StudyError(problems.join("\n"));
    }
    const seen = new Set<string>();
    parsed.data.forEach((row, i) => {
        // Line 1 is the header.
        const where = `${path} line ${i + 2}`;
        for (const column of columns) {
            row[column] = (row[column] ?? "").trim();
            if (!row[column]) {
                problems.push(`${where}: ${column} is empty`);
            }
        }
        if (seen.has(row.id)) {
            problems.push(`${where}: ID ${row.id} is used more than once`);
        }
        seen.add(row.id);
    });
    if (problems.length) {
        throw new StudyError(problems.join("\n"));
    }
    return parsed.data;
}

// Where a reel goes in the build: assets/reels/, with a hash of its contents in
// its name like the rest of assets/, so it can be cached for good.
function reelBuildPath(reelsDir: string, file: string): string {
    const hash = createHash("sha256").update(readFileSync(join(reelsDir, file)))
        .digest("base64url").slice(0, 8);
    const ext = extname(file);
    return `assets/reels/${file.slice(0, file.length - ext.length)}-${hash}${ext}`;
}

function isURL(file: string): boolean {
    return /^https?:\/\//i.test(file);
}

export default function teddyStudy(): Plugin {
    const studyDir = resolve(process.env.TEDDY_STUDY || "example-study");
    const reelsDir = join(studyDir, "reels");
    let viteConfig: ResolvedConfig;
    // Reel files to copy into the build, from their path in reels/ to their
    // path in the build.
    let reelFiles = new Map<string, string>();

    return {
        name: "teddy-study",

        config() {
            // Lets the dev server serve reels straight from the study folder.
            // Setting allow replaces Vite's default, so the project stays in it.
            return {server: {fs: {allow: [searchForWorkspaceRoot(process.cwd()), studyDir]}}};
        },

        configResolved(resolved) {
            viteConfig = resolved;
            console.log(`Building study ${relative(process.cwd(), studyDir) || "."}`);
        },

        resolveId(id) {
            return id == VIRTUAL_ID ? RESOLVED_ID : null;
        },

        async load(id) {
            if (id != RESOLVED_ID) {
                return null;
            }
            const configPath = join(studyDir, "config.js");
            this.addWatchFile(configPath);
            const config = await loadConfig(configPath);

            const items: Record<string, Record<string, Row>> = {};
            for (const [module, {file, columns}] of Object.entries(MODULE_FILES)) {
                const path = join(studyDir, file);
                this.addWatchFile(path);
                items[module] = Object.fromEntries(loadItems(path, columns).map(row => [row.id, row]));
            }

            // Each reel gets a url to play it from. Files in reels/ are copied to
            // assets/reels/ in the build; URLs are used as they are.
            const missing: string[] = [];
            reelFiles = new Map();
            for (const reel of Object.values(items.reels)) {
                if (isURL(reel.file)) {
                    reel.url = reel.file;
                    continue;
                }
                const path = resolve(reelsDir, reel.file);
                if (relative(reelsDir, path).startsWith("..")) {
                    missing.push(`reel ${reel.id}: ${reel.file} isn't inside reels/`);
                } else if (!existsSync(path)) {
                    missing.push(`reel ${reel.id}: ${path} doesn't exist`);
                } else if (viteConfig.command == "serve") {
                    reel.url = "/@fs" + path;
                } else {
                    if (!reelFiles.has(reel.file)) {
                        reelFiles.set(reel.file, reelBuildPath(reelsDir, reel.file));
                    }
                    reel.url = reelFiles.get(reel.file)!;
                }
            }
            if (missing.length) {
                throw new StudyError(missing.join("\n"));
            }

            return [
                `export const config = ${JSON.stringify(config)};`,
                `export const sentences = ${JSON.stringify(items.sentence)};`,
                `export const videoLogPrompts = ${JSON.stringify(items.videolog)};`,
                `export const reels = ${JSON.stringify(items.reels)};`,
            ].join("\n");
        },

        configureServer(server) {
            // Reload the page when anything in the study changes.
            server.watcher.add(studyDir);
            server.watcher.on("change", file => {
                if (!relative(studyDir, file).startsWith("..")) {
                    const module = server.moduleGraph.getModuleById(RESOLVED_ID);
                    if (module) {
                        server.moduleGraph.invalidateModule(module);
                    }
                    server.ws.send({type: "full-reload"});
                }
            });
        },

        writeBundle() {
            const outDir = resolve(viteConfig.root, viteConfig.build.outDir);
            for (const [file, buildPath] of reelFiles) {
                const target = join(outDir, buildPath);
                mkdirSync(dirname(target), {recursive: true});
                cpSync(join(reelsDir, file), target);
            }
        },
    };
}
