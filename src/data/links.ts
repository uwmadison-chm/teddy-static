// Reading the `modules` parameter of a link: which modules to run, in order,
// and their items. Used by the session, and in debug mode by the link builder.

import {itemIDs, modules, questions, reels, sentences, videoLogPrompts, type StudyItem} from "virtual:teddy-study";

export const ModuleNames = {
    Questions: "questions",
    Reels: "reels",
    Sentences: "sentences",
    VideoLogs: "videologs",
}

export class ModuleParam {
    module: string;
    args: string[];

    constructor(module: string, args: string[]) {
        this.module = module;
        this.args = args;
    }
}

// The study's item IDs for `moduleName`, in the CSV's order.
export function moduleItemIDs(moduleName: string): string[] {
    return itemIDs[moduleName] ?? [];
}

// The study's items for `moduleName`, by ID.
export function moduleItems(moduleName: string): Record<string, StudyItem> {
    return {
        [ModuleNames.Questions]: questions,
        [ModuleNames.Reels]: reels,
        [ModuleNames.Sentences]: sentences,
        [ModuleNames.VideoLogs]: videoLogPrompts,
    }[moduleName] ?? {};
}

// The modules this study uses, in Teddy's order.
export function studyModules(): string[] {
    return Object.values(ModuleNames).filter((name) => modules.includes(name));
}

// Parses `modulesText`, like "videologs:01,03|sentences:02". Returns the modules
// that could be read, and a sentence for each problem that means the session
// can't run as asked.
export function parseModules(modulesText: string): {modules: ModuleParam[], problems: string[]} {
    const parsed: ModuleParam[] = [];
    const problems: string[] = [];
    for (const moduleText of modulesText.split("|").filter(x => !!x)) {
        const parts = moduleText.split(":");
        const moduleName = parts[0].toLowerCase();
        const args = (parts[1] || "").split(",").filter(x => !!x);
        if (!Object.values(ModuleNames).includes(moduleName)) {
            problems.push(`There's no module called ${parts[0]}`);
            continue;
        }
        if (!modules.includes(moduleName)) {
            problems.push(`This study doesn't use the ${moduleName} module`);
            continue;
        }
        parsed.push(new ModuleParam(moduleName, args));
        if (!args.length) {
            problems.push(`The ${moduleName} module needs item IDs, like ${moduleName}:01,02`);
        }
        const known = moduleItems(moduleName);
        for (const id of args) {
            if (!(id in known)) {
                problems.push(`The ${moduleName} module has no item with ID ${id}`);
            }
        }
    }
    return {modules: parsed, problems};
}
