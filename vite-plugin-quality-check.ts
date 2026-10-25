// Builds the quality-check page's settings in. QC_SETTINGS names the settings
// file; it defaults to quality-check/settings.js. The page imports them from
// "virtual:quality-check-settings", and anything wrong with them stops the build.

import {existsSync} from "node:fs";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import type {Plugin, ViteDevServer} from "vite";
import {gitState, typeOf} from "./vite-plugin-study.ts";

const VIRTUAL_ID = "virtual:quality-check-settings";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

const KEYS: Record<string, string> = {
    pigServer: "string",
    taskCode: "string",
    debug: "boolean",
    formats: "array",
    bitrates: "array",
    sizes: "array",
    frameRate: "number",
    audioBitsPerSecond: "number",
    maxSeconds: "number",
    prompts: "string[]",
};

async function loadSettings(path: string): Promise<Record<string, unknown>> {
    if (!existsSync(path)) {
        throw new Error(`${path} doesn't exist`);
    }
    // The query string makes Node load the file again after it changes.
    const settings = (await import(pathToFileURL(path).href + "?t=" + Date.now())).default;
    if (typeOf(settings) != "object") {
        throw new Error(`${path} needs to export default an object of settings`);
    }
    const problems: string[] = [];
    for (const key of Object.keys(settings)) {
        if (!(key in KEYS)) {
            problems.push(`unknown setting ${key}`);
        }
    }
    for (const [key, type] of Object.entries(KEYS)) {
        const actual = typeOf(settings[key]);
        // An array of strings is an array too.
        if (actual != type && !(type == "array" && actual == "string[]" && settings[key].length == 0)) {
            problems.push(`${key} should be a ${type}, not ${actual}`);
        }
    }
    const each = (key: string, check: (item: unknown) => boolean, shape: string) => {
        if (Array.isArray(settings[key])) {
            if (!settings[key].length) {
                problems.push(`${key} is empty`);
            }
            settings[key].forEach((item: unknown, index: number) => {
                if (!check(item)) {
                    problems.push(`${key}[${index}] should be ${shape}`);
                }
            });
        }
    };
    const isObject = (item: unknown): item is Record<string, unknown> => typeOf(item) == "object";
    each("formats", item => isObject(item) && typeof item.label == "string" && typeof item.mimeType == "string", "{label, mimeType}");
    each("bitrates", item => typeof item == "number" && item > 0, "a number of bits per second");
    each("sizes", item => isObject(item) && typeof item.label == "string" && typeof item.width == "number" && typeof item.height == "number", "{label, width, height}");
    each("prompts", item => typeof item == "string" && item != "", "some text");
    if (!settings.debug && (!settings.pigServer || !settings.taskCode)) {
        problems.push("pigServer and taskCode are needed unless debug is true");
    }
    if (problems.length) {
        throw new Error(`${path}:\n` + problems.join("\n"));
    }
    return settings;
}

export default function qualityCheckSettings(): Plugin {
    const path = resolve(process.env.QC_SETTINGS || "quality-check/settings.js");
    const teddyDir = import.meta.dirname;
    let server: ViteDevServer | undefined;

    return {
        name: "teddy-quality-check-settings",

        resolveId(id) {
            return id == VIRTUAL_ID ? RESOLVED_ID : undefined;
        },

        async load(id) {
            if (id != RESOLVED_ID) {
                return;
            }
            const settings = await loadSettings(path);
            const version = JSON.parse(readFileSync(join(teddyDir, "package.json"), "utf8")).version;
            return [
                `export const settings = ${JSON.stringify(settings)};`,
                `export const build = ${JSON.stringify({teddy: {version, ...gitState(teddyDir)}})};`,
            ].join("\n");
        },

        configureServer(devServer) {
            server = devServer;
            devServer.watcher.add(path);
            devServer.watcher.on("change", file => {
                if (file == path) {
                    const module = server?.moduleGraph.getModuleById(RESOLVED_ID);
                    if (module) {
                        server?.moduleGraph.invalidateModule(module);
                    }
                    devServer.ws.send({type: "full-reload"});
                }
            });
        },
    };
}
