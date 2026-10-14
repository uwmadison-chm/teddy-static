// Builds a study into Teddy. A study is a folder holding config.js, which names
// a CSV of items for each module the study uses, and the reel videos.
// TEDDY_STUDY names the folder; it defaults to example-study/.
//
// The app imports all of it from "virtual:teddy-study". Anything wrong with the
// study (a missing setting, a duplicate ID, a reel file that isn't there) stops
// the build, rather than turning up for a participant.

import {createHash} from "node:crypto";
import {closeSync, cpSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync} from "node:fs";
import {dirname, extname, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import Papa from "papaparse";
import {searchForWorkspaceRoot, type Plugin, type ResolvedConfig, type ViteDevServer} from "vite";

const VIRTUAL_ID = "virtual:teddy-study";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

// The settings config.js may have, and the type of each.
const CONFIG_KEYS: Record<string, string> = {
    pigServer: "string",
    taskCode: "string",
    debug: "boolean",
    nextUrlHosts: "string[]",
    recording: "object",
    modules: "object",
};
const RECORDING_KEYS: Record<string, string> = {
    mimeTypes: "string[]",
    videoBitsPerSecond: "number",
    audioBitsPerSecond: "number",
    width: "number",
    height: "number",
    frameRate: "number",
};

// The columns each module's CSV has to have. Other columns are allowed, and
// come along with each item.
const MODULE_COLUMNS: Record<string, string[]> = {
    sentence: ["id", "text"],
    videolog: ["id", "text"],
    reels: ["id", "file"],
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
    if (typeOf(config.modules) == "object") {
        const moduleKeys = Object.fromEntries(Object.keys(MODULE_COLUMNS).map(m => [m, "string"]));
        checkKeys("config.js modules", config.modules, moduleKeys, problems);
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
        throw new StudyError(`${path} doesn't exist`);
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
// its name like the rest of assets/, so it can be cached for good. file is
// relative to reelsDir, the reels CSV's folder.
function reelBuildPath(reelsDir: string, file: string): string {
    const hash = createHash("sha256").update(readFileSync(join(reelsDir, file)))
        .digest("base64url").slice(0, 8);
    const ext = extname(file);
    return `assets/reels/${file.slice(0, file.length - ext.length)}-${hash}${ext}`;
}

// Whether an MP4 has its index (the moov box) after the video data (mdat), so
// a browser has to download the whole file before it can start playing it.
// Reads only the top-level box headers. Files that aren't MP4 are false.
function indexAtEnd(path: string): boolean {
    const fd = openSync(path, "r");
    try {
        const fileSize = fstatSync(fd).size;
        const header = Buffer.alloc(16);
        let offset = 0;
        let first = true;
        while (offset + 8 <= fileSize) {
            readSync(fd, header, 0, 16, offset);
            const type = header.toString("latin1", 4, 8);
            if (first && type != "ftyp") {
                return false;
            }
            first = false;
            if (type == "moov") {
                return false;
            }
            if (type == "mdat") {
                return true;
            }
            // A size of 1 means a 64-bit size follows; 0 means the box runs
            // to the end of the file.
            let size = header.readUInt32BE(0);
            if (size == 1) {
                size = Number(header.readBigUInt64BE(8));
            } else if (size == 0) {
                return false;
            }
            if (size < 8) {
                return false;
            }
            offset += size;
        }
        return false;
    } finally {
        closeSync(fd);
    }
}

function isURL(file: string): boolean {
    return /^https?:\/\//i.test(file);
}

export default function teddyStudy(): Plugin {
    const studyDir = resolve(process.env.TEDDY_STUDY || "example-study");
    let viteConfig: ResolvedConfig;
    // The reels CSV's folder; reel files are found relative to it.
    let reelsDir = studyDir;
    // Reel files to copy into the build, from their path in reelsDir to their
    // path in the build.
    let reelFiles = new Map<string, string>();
    // config.js and the CSVs, which the dev server reloads the page for. Only
    // these are watched, since the study folder may hold a lot else (even this
    // checkout, as a submodule).
    const studyFiles = new Set<string>();
    let server: ViteDevServer | undefined;

    function watch(path: string) {
        studyFiles.add(path);
        server?.watcher.add(path);
    }

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
            watch(configPath);
            const config = await loadConfig(configPath);

            // Only the modules config.js names are in this build; links that
            // name any other module are refused.
            const moduleFiles = (config.modules || {}) as Record<string, string>;
            const items: Record<string, Record<string, Row>> = {};
            for (const [module, columns] of Object.entries(MODULE_COLUMNS)) {
                if (!moduleFiles[module]) {
                    items[module] = {};
                    continue;
                }
                const path = resolve(studyDir, moduleFiles[module]);
                watch(path);
                items[module] = Object.fromEntries(loadItems(path, columns).map(row => [row.id, row]));
            }

            // Each reel gets a url to play it from. Files are found relative to
            // the reels CSV and copied to assets/reels/ in the build; URLs are
            // used as they are.
            const missing: string[] = [];
            reelsDir = moduleFiles.reels ? dirname(resolve(studyDir, moduleFiles.reels)) : studyDir;
            reelFiles = new Map();
            for (const reel of Object.values(items.reels)) {
                if (isURL(reel.file)) {
                    reel.url = reel.file;
                    continue;
                }
                const path = resolve(reelsDir, reel.file);
                if (relative(reelsDir, path).startsWith("..")) {
                    missing.push(`reel ${reel.id}: ${reel.file} isn't inside ${reelsDir}`);
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
            for (const file of new Set(Object.values(items.reels).filter(r => !isURL(r.file)).map(r => r.file))) {
                if (indexAtEnd(resolve(reelsDir, file))) {
                    this.warn(`${file} has its index at the end, so it won't start playing until it has all downloaded. ` +
                        `To move the index to the start without re-encoding: ffmpeg -i INPUT -c copy -movflags +faststart OUTPUT`);
                }
            }

            const {modules: _, ...settings} = config;
            return [
                `export const config = ${JSON.stringify(settings)};`,
                `export const modules = ${JSON.stringify(Object.keys(moduleFiles))};`,
                `export const sentences = ${JSON.stringify(items.sentence)};`,
                `export const videoLogPrompts = ${JSON.stringify(items.videolog)};`,
                `export const reels = ${JSON.stringify(items.reels)};`,
            ].join("\n");
        },

        configureServer(devServer) {
            server = devServer;
            devServer.watcher.add([...studyFiles]);
            devServer.watcher.on("change", file => {
                if (studyFiles.has(file)) {
                    const module = devServer.moduleGraph.getModuleById(RESOLVED_ID);
                    if (module) {
                        devServer.moduleGraph.invalidateModule(module);
                    }
                    devServer.ws.send({type: "full-reload"});
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
