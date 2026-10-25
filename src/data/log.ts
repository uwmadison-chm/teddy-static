// Where events go. Components that are shared between pages, like Teddy
// himself, log through here rather than through a page's own session, so they
// don't pull that page's settings in with them. Each page sets the sink when
// it starts: Teddy's session sends events to pig with the module and
// recording running (sessionData.tsx), and the quality check sends its own.

export type Level = "info" | "warning" | "error";

type Sink = (type: string, fields: Record<string, unknown>, level: Level) => void;

let sink: Sink = (type, fields) => console.log("Event, with nowhere to send it:", type, fields);

export function setEventSink(newSink: Sink): void {
    sink = newSink;
}

// Sends an event: `type` says what happened, in snake_case; `fields` are
// anything else worth keeping; `level` says whether it went badly.
export function logEvent(type: string, fields: Record<string, unknown> = {}, level: Level = "info"): void {
    sink(type, fields, level);
}

// An error's name and message, and the start of its stack, for an event.
export function errorFields(error: unknown): {name: string, message: string, stack?: string} {
    if (error instanceof Error || (error != null && typeof error == "object" && "name" in error)) {
        const e = error as Error;
        const fields: {name: string, message: string, stack?: string} = {name: String(e.name), message: String(e.message ?? "")};
        if (e.stack) {
            fields.stack = e.stack.split("\n").slice(0, 6).join("\n");
        }
        return fields;
    }
    return {name: "Error", message: String(error)};
}
