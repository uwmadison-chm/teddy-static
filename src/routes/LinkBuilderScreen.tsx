import {useEffect, useMemo, useRef, useState} from "react";
import {allowedNextURL, Config} from "@/data/config.ts";
import {moduleItemIDs, moduleItems, parseModules, studyModules} from "@/data/links.ts";
import {setCanLeavePageSafely} from "@/data/sessionData.tsx";

// Parameters Teddy reads itself; any others go to pig.
const TEDDY_PARAMS = ["modules", "nextURL", "expirationTime"];

interface Step {
    key: number;
    module: string;
    ids: string[];
}

// An item's text, or a reel's file, cut short to fit on a line.
function itemText(module: string, id: string): string {
    const item = moduleItems(module)[id];
    const text = item ? (item.text ?? item.file ?? "") : "";
    return text.length > 90 ? text.slice(0, 88) + "…" : text;
}

// Writes the modules parameter readably: | : and , are fine in a query string.
function modulesParam(steps: Step[]): string {
    return steps
        .filter((step) => step.ids.length)
        .map((step) => `${step.module}:${step.ids.map(encodeURIComponent).join(",")}`)
        .join("|");
}

function buildLink(steps: Step[], nextURL: string, expires: string, extra: string): string {
    const params = new URLSearchParams();
    for (const line of extra.split("\n")) {
        const at = line.indexOf("=");
        if (at > 0) {
            params.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
        }
    }
    if (nextURL.trim()) {
        params.set("nextURL", nextURL.trim());
    }
    if (expires) {
        params.set("expirationTime", String(new Date(expires).getTime()));
    }
    const modules = modulesParam(steps);
    const rest = params.toString();
    const query = [modules && `modules=${modules}`, rest].filter(Boolean).join("&");
    return window.location.origin + window.location.pathname + (query ? "?" + query : "");
}

// What Teddy will make of `link`, line by line, and what's wrong with it.
function checkLink(link: string): {notes: string[], problems: string[]} {
    const notes: string[] = [];
    const problems: string[] = [];
    let url: URL;
    try {
        url = new URL(link.trim(), window.location.href);
    } catch {
        return {notes, problems: ["This isn't a URL."]};
    }
    const params = url.searchParams;

    const parsed = parseModules(params.get("modules") || "");
    problems.push(...parsed.problems);
    if (!parsed.modules.length && !parsed.problems.length) {
        notes.push("No modules: the session is the face check and calibration, then the end.");
    }
    parsed.modules.forEach((m, i) => {
        notes.push(`${i + 1}. ${m.module}`);
        for (const id of m.args) {
            const text = itemText(m.module, id);
            notes.push(`    ${id}: ${text || "(no such item)"}`);
        }
    });

    const rawNext = params.get("nextURL");
    if (rawNext) {
        if (allowedNextURL(rawNext)) {
            notes.push(`At the end, goes to ${rawNext}`);
        } else {
            problems.push(Config.nextUrlHosts.length ?
                `nextURL isn't an http(s) URL on ${Config.nextUrlHosts.join(" or ")}, so it will be ignored.` :
                "nextURL isn't an http(s) URL, so it will be ignored.");
        }
    } else {
        notes.push("No nextURL: the end screen says the tab can be closed.");
    }

    const rawExpiry = params.get("expirationTime");
    if (rawExpiry) {
        const expiry = parseInt(rawExpiry);
        if (isNaN(expiry)) {
            problems.push("expirationTime isn't a number of milliseconds, so it will be ignored.");
        } else if (expiry < Date.now()) {
            problems.push(`This link expired ${new Date(expiry).toLocaleString()}.`);
        } else {
            notes.push(`Works until ${new Date(expiry).toLocaleString()}.`);
        }
    }

    const toPig = [...params.keys()].filter((key) => !TEDDY_PARAMS.includes(key));
    if (toPig.length) {
        notes.push(`Sent to pig only: ${toPig.join(", ")}`);
    }
    if (url.origin + url.pathname != window.location.origin + window.location.pathname) {
        notes.push(`Checked against this build's study, but the link points to ${url.origin + url.pathname}.`);
    }
    return {notes, problems};
}

// Debug mode only, at ?links: builds a link from the study's modules and items,
// and checks a pasted one the way the session will read it. ?links&check=<link>
// opens with that link to check.
export default function LinkBuilderScreen() {
    const [steps, setSteps] = useState<Step[]>([]);
    const [nextKey, setNextKey] = useState(0);
    const [nextURL, setNextURL] = useState("");
    const [expires, setExpires] = useState("");
    const [extra, setExtra] = useState("");
    const toCheck = new URLSearchParams(window.location.search).get("check");
    const [link, setLink] = useState(toCheck || "");
    // Keep a link given to check until the builder is used.
    const keptForRef = useRef(toCheck ? JSON.stringify([[], "", "", ""]) : null);
    const [copied, setCopied] = useState(false);

    // Nothing to lose on this page.
    useEffect(() => setCanLeavePageSafely(), []);

    useEffect(() => {
        if (keptForRef.current == JSON.stringify([steps, nextURL, expires, extra])) {
            return;
        }
        keptForRef.current = null;
        setLink(buildLink(steps, nextURL, expires, extra));
        setCopied(false);
    }, [steps, nextURL, expires, extra]);

    const check = useMemo(() => checkLink(link), [link]);

    function updateStep(key: number, change: (step: Step) => Step | null) {
        setSteps((current) => current.flatMap((step) => {
            if (step.key != key) {
                return [step];
            }
            const changed = change(step);
            return changed ? [changed] : [];
        }));
    }

    function move(index: number, by: number) {
        setSteps((current) => {
            const moved = [...current];
            const [step] = moved.splice(index, 1);
            moved.splice(Math.max(0, Math.min(moved.length, index + by)), 0, step);
            return moved;
        });
    }

    return (
        <div className={"link-builder"}>
            <h1>Link builder</h1>
            <p>Debug mode only. Pick modules and items, or paste a link below to check it.</p>

            <h2>Modules, in order</h2>
            {steps.map((step, index) => {
                const items = moduleItemIDs(step.module);
                return (
                    <fieldset key={step.key}>
                        <legend>
                            {index + 1}. {step.module}
                            {" "}<button onClick={() => move(index, -1)} disabled={index == 0} aria-label={"Move up"}>↑</button>
                            <button onClick={() => move(index, 1)} disabled={index == steps.length - 1} aria-label={"Move down"}>↓</button>
                            <button onClick={() => updateStep(step.key, () => null)}>Remove</button>
                            <button onClick={() => updateStep(step.key, (s) => ({...s, ids: s.ids.length == items.length ? [] : items}))}>
                                {step.ids.length == items.length ? "None" : "All"}
                            </button>
                        </legend>
                        {items.map((id) =>
                            <label key={id}>
                                <input type={"checkbox"}
                                       checked={step.ids.includes(id)}
                                       onChange={(e) => updateStep(step.key, (s) => ({
                                           ...s,
                                           // Items run in the CSV's order.
                                           ids: items.filter((i) => i == id ? e.target.checked : s.ids.includes(i)),
                                       }))}/>
                                <code>{id}</code> {itemText(step.module, id)}
                            </label>
                        )}
                    </fieldset>
                );
            })}
            <p>
                Add:{" "}
                {studyModules().map((module) =>
                    <button key={module} onClick={() => {
                        setSteps((current) => [...current, {key: nextKey, module, ids: []}]);
                        setNextKey(nextKey + 1);
                    }}>{module}</button>
                )}
            </p>

            <h2>Other parameters</h2>
            <label className={"field"}>
                nextURL (where the end screen sends them)
                <input type={"url"} value={nextURL} onChange={(e) => setNextURL(e.target.value)}
                       placeholder={"https://redcap.example.edu/surveys/?s=..."}/>
            </label>
            <label className={"field"}>
                Expires
                <input type={"datetime-local"} value={expires} onChange={(e) => setExpires(e.target.value)}/>
            </label>
            <label className={"field"}>
                Parameters for pig, one name=value per line
                <textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)}
                          placeholder={"participant=1001"}/>
            </label>

            <h2>Link</h2>
            <textarea className={"link"} rows={4} value={link} onChange={(e) => setLink(e.target.value)}
                      aria-label={"Link"}/>
            <p>
                <button onClick={() => {
                    navigator.clipboard.writeText(link).then(() => setCopied(true));
                }}>{copied ? "Copied" : "Copy"}</button>
                {" "}<a href={link} target={"_blank"} rel={"noreferrer"}>Open in a new tab</a>
            </p>

            <h2>{check.problems.length ? "Problems" : "No problems"}</h2>
            {check.problems.length > 0 && <ul className={"problems"}>
                {check.problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>}
            <pre>{check.notes.join("\n")}</pre>
        </div>
    );
}
