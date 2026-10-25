// Writes REDCap randomization lists for Teddy: one CSV per REDCap event, each
// with the columns redcap_randomization_number and redcap_randomization_group,
// both set to a row's modules parameter, like
// questions:1,2,3,4,5|reels:07,02,11|videologs:1,2
//
// --modules is a modules parameter in which a module's items can be
// pick(N): N of that module's items, chosen at random for each row with no
// repeats in the row. Every row of every event gets its own draw. Items are
// the study's, from its config.js, so pick() only chooses items the build has
// and listed IDs are checked against it.
//
// Usage:
//   node scripts/generate-lists.ts --out-dir=lists/ --count=100 --events=base,pw1 \
//       --modules='questions:1,2,3,4,5|reels:pick(3)|sentences:pick(3)|videologs:1,2'
//
// Quote --modules, since | means something to the shell. The study is
// TEDDY_STUDY, or example-study/, as for the build; --study overrides it.
// --seed makes the lists repeatable.

import {mkdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {loadConfig, loadItems, MODULE_COLUMNS, StudyError} from "../vite-plugin-study.ts";

const USAGE = `Usage: node scripts/generate-lists.ts --out-dir=DIR --count=N --events=EVENT,... --modules=MODULES [--study=DIR] [--seed=N]

  --modules   a modules parameter, like 'questions:1,2,3|reels:pick(3)'. pick(N) chooses
              N of the module's items for each row, with no repeats in the row.
  --study     the study folder (default: TEDDY_STUDY, or example-study)
  --seed      makes the lists the same each time`;

// One module of --modules: its listed item IDs, or how many to pick.
type ModuleSpec = {module: string, ids: string[] | null, pick: number};

// The study's item IDs for each module it uses, in the CSV's order.
async function studyItemIDs(studyDir: string): Promise<Record<string, string[]>> {
    const config = await loadConfig(join(studyDir, "config.js"));
    const moduleFiles = (config.modules || {}) as Record<string, string>;
    const itemIDs: Record<string, string[]> = {};
    for (const [module, file] of Object.entries(moduleFiles)) {
        itemIDs[module] = loadItems(resolve(studyDir, file), MODULE_COLUMNS[module]).map(row => row.id);
    }
    return itemIDs;
}

// Parses --modules against the study's items. Returns the modules, and a
// sentence for each problem.
function parseModuleSpecs(text: string, itemIDs: Record<string, string[]>): {specs: ModuleSpec[], problems: string[]} {
    const specs: ModuleSpec[] = [];
    const problems: string[] = [];
    for (const moduleText of text.split("|").filter(x => !!x)) {
        const m = moduleText.match(/^([^:]+):(.*)$/);
        if (!m) {
            problems.push(`${moduleText} needs a colon before its items, like sentences:01,02 or sentences:pick(3)`);
            continue;
        }
        const module = m[1].trim().toLowerCase();
        const args = m[2].trim();
        if (!(module in MODULE_COLUMNS)) {
            problems.push(`There's no module called ${m[1]}`);
            continue;
        }
        const known = itemIDs[module];
        if (!known) {
            problems.push(`This study doesn't use the ${module} module`);
            continue;
        }
        const pick = args.match(/^pick\((\d+)\)$/i);
        if (pick) {
            const n = Number(pick[1]);
            if (n < 1 || n > known.length) {
                problems.push(`${module}: can't pick ${n} from ${known.length} items`);
            }
            specs.push({module, ids: null, pick: n});
            continue;
        }
        const ids = args.split(",").map(x => x.trim()).filter(x => !!x);
        if (!ids.length) {
            problems.push(`${module} needs items, like ${module}:01,02 or ${module}:pick(3)`);
        }
        for (const id of ids) {
            if (!known.includes(id)) {
                problems.push(`The ${module} module has no item with ID ${id}`);
            }
        }
        specs.push({module, ids, pick: 0});
    }
    return {specs, problems};
}

// mulberry32: a small seeded generator, so --seed gives the same lists.
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// n items from `items`, in random order, with no repeats.
function pickFrom(items: string[], n: number, random: () => number): string[] {
    const pool = [...items];
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

function modulesParam(specs: ModuleSpec[], itemIDs: Record<string, string[]>, random: () => number): string {
    return specs.map(spec => {
        const ids = spec.ids ?? pickFrom(itemIDs[spec.module], spec.pick, random);
        return `${spec.module}:${ids.join(",")}`;
    }).join("|");
}

function csvField(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
    const {values} = parseArgs({
        options: {
            "out-dir": {type: "string"},
            count: {type: "string"},
            events: {type: "string"},
            modules: {type: "string"},
            study: {type: "string"},
            seed: {type: "string"},
            help: {type: "boolean", short: "h"},
        },
    });
    if (values.help) {
        console.log(USAGE);
        return;
    }
    const problems: string[] = [];
    for (const required of ["out-dir", "count", "events", "modules"] as const) {
        if (!values[required]) {
            problems.push(`--${required} is required`);
        }
    }
    const count = Number(values.count);
    if (values.count && !(Number.isInteger(count) && count > 0)) {
        problems.push("--count should be a whole number more than 0");
    }
    const events = (values.events || "").split(",").map(x => x.trim()).filter(x => !!x);
    if (values.events && !events.length) {
        problems.push("--events needs at least one event name");
    }
    if (new Set(events).size != events.length) {
        problems.push("--events names an event more than once");
    }
    const seed = values.seed === undefined ? null : Number(values.seed);
    if (seed !== null && !Number.isInteger(seed)) {
        problems.push("--seed should be a whole number");
    }
    if (problems.length) {
        throw new StudyError(problems.join("\n") + "\n\n" + USAGE);
    }

    const studyDir = resolve(values.study || process.env.TEDDY_STUDY || "example-study");
    const itemIDs = await studyItemIDs(studyDir);
    const parsed = parseModuleSpecs(values.modules!, itemIDs);
    if (!parsed.specs.length && !parsed.problems.length) {
        parsed.problems.push("--modules names no modules");
    }
    if (parsed.problems.length) {
        throw new StudyError(parsed.problems.join("\n"));
    }

    const random = seed === null ? Math.random : seededRandom(seed);
    const outDir = resolve(values["out-dir"]!);
    mkdirSync(outDir, {recursive: true});
    for (const event of events) {
        const lines = ["redcap_randomization_number,redcap_randomization_group"];
        for (let i = 0; i < count; i++) {
            const param = csvField(modulesParam(parsed.specs, itemIDs, random));
            lines.push(`${param},${param}`);
        }
        const path = join(outDir, `${event}.csv`);
        writeFileSync(path, lines.join("\n") + "\n");
        console.log(`Wrote ${count} rows to ${path}`);
    }
}

main().catch(e => {
    if (!(e instanceof StudyError)) {
        throw e;
    }
    console.error(e.message);
    process.exit(1);
});
