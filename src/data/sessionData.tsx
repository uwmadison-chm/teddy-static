import {allowedNextURL, Config} from "@/data/config.ts";
import {runId, type RunOutcome, sendEvent, setOpeningEvent} from "@/data/pig.ts";
import {saveSession} from "@/data/revisit.ts";
import {type ModuleParam, parseModules} from "@/data/links.ts";
import {build} from "virtual:teddy-study";
import {errorFields, type Level, setEventSink} from "@/data/log.ts";

export {errorFields} from "@/data/log.ts";
export type {Level} from "@/data/log.ts";

// The version of the events Teddy sends, documented in docs/events.md. Bump
// the minor version for anything added, and the major version for anything
// renamed, removed, or changed in meaning.
export const EVENT_SCHEMA = "1.5";

// The most uncaught_exception events one session sends.
const MAX_SCRIPT_ERRORS = 20;

// How an event went (Level): "warning" means the session carried on, but its
// data may be affected; "error", that something didn't work.

// The session's state. What happens in it goes to pig as events, through
// logEvent(); the link's parameters reach pig when the run starts (see pig.ts).
class SessionData {
    expirationTime?: number;
    nextURL: string | null;
    isCompleted: boolean;

    modules: ModuleParam[];
    linkProblems: string[];
    currentModule: number;
    // True on the calibration screen, which runs before the first module.
    calibrating = false;
    // How many of the current module's items are done. A module's screen
    // starts at this one, so a revisit, or a screen restarted after camera
    // help, goes back to the item it was on.
    currentItem = 0;
    // True from picking up a run on a revisit until the face check after it is
    // done; then the session goes on to currentModule + 1, at currentItem.
    resuming = false;
    // The recording running now, by its number in the session, if any.
    currentRecording: number | null = null;
    private recordings = 0;

    constructor() {
        const params = new URLSearchParams(window.location.search);
        this.expirationTime = parseInt(params.get("expirationTime"));
        this.nextURL = allowedNextURL(params.get("nextURL"));
        this.isCompleted = false;

        if (params.get("nextURL") && !this.nextURL) {
            console.warn("Ignoring nextURL; it isn't an allowed http(s) URL:", params.get("nextURL"));
        }
        this.currentModule = -1;

        // Problems with the link that mean the session can't run as asked.
        // With no modules, the session is just the face check and calibration.
        const parsed = parseModules(params.get("modules") || "");
        this.modules = parsed.modules;
        this.linkProblems = parsed.problems;
        if (this.linkProblems.length) {
            console.error("Problems with this link:", this.linkProblems);
        }
        console.log("Starting session with modules", this.modules);
        // The run's first event: session_started for a new run, or
        // session_resumed for one picked up from an earlier visit.
        const opening = {
            schema: EVENT_SCHEMA,
            teddy: build.teddy,
            study: {task_code: Config.taskCode, ...build.study},
            debug: Config.debug,
            modules: this.modules.map((m) => ({[m.module]: m.args})),
            link_problems: this.linkProblems,
            next_url: this.nextURL,
            next_url_rejected: params.get("nextURL") && !this.nextURL ? params.get("nextURL") : null,
            expiration_time: Number.isNaN(this.expirationTime) ? null : this.expirationTime,
        };
        setOpeningEvent((outcome) => this.runStarted(outcome, opening));

        // The participant switching tabs or apps, or locking their phone.
        document.addEventListener("visibilitychange", () => {
            // Hidden during a recording, the video likely doesn't show what it should.
            const hidden = document.visibilityState == "hidden";
            this.logEvent(hidden ? "tab_hidden" : "tab_shown", {},
                hidden && this.currentRecording != null ? "warning" : "info");
        });
        // Anything that goes wrong that nothing else caught. An error that
        // repeats, say in a timer, stops being sent after the first few.
        let scriptErrors = 0;
        const logScriptError = (error: unknown) => {
            if (++scriptErrors <= MAX_SCRIPT_ERRORS) {
                this.logEvent("uncaught_exception", errorFields(error), "error");
            }
        };
        window.addEventListener("error", (e) => logScriptError(e.error ?? e.message));
        window.addEventListener("unhandledrejection", (e) => logScriptError(e.reason));
    }

    // Once the run has started, picks up where an earlier visit left off if
    // it resumed one, and saves the session so a later visit can. Returns the
    // run's first event.
    private runStarted({resumed, resumeFailed}: RunOutcome, fields: Record<string, unknown>): Record<string, unknown> {
        if (resumed == null) {
            // A tab opened while another has the session leaves that session's
            // progress alone until this one gets as far as a module.
            if (resumeFailed != "busy") {
                this.saveProgress();
            }
            return this.event("session_started", {...fields, resume_failed: resumeFailed});
        }
        // Made before the state changes, so its module is null, like
        // session_started's: the participant is on the intro.
        const data = this.event("session_resumed", {
            ...fields,
            module_index: resumed.module,
            calibrating: resumed.calibrating,
            item_index: resumed.item,
        });
        this.recordings = resumed.recordings;
        // Before the first module, the session just starts again with
        // calibration. Otherwise the camera and face check come first, then
        // the module (see CalibrationScreen).
        if (resumed.module >= 0 && !resumed.calibrating && resumed.module < this.modules.length) {
            this.currentModule = resumed.module - 1;
            this.currentItem = resumed.item;
            this.resuming = true;
        }
        this.saveProgress();
        return data;
    }

    // Saves where the session is, for a revisit to pick up (see revisit.ts).
    private saveProgress(): void {
        saveSession({
            runId: runId(),
            // While resuming, the face check stands in for the module to go back to.
            module: this.resuming ? this.currentModule + 1 : this.currentModule,
            calibrating: this.resuming ? false : this.calibrating,
            item: this.currentItem,
            recordings: this.recordings,
        });
    }

    // Sends an event to pig. `type` says what happened, in snake_case; `fields`
    // are anything else worth keeping; `level` says whether this time it went
    // badly. Every event also says which module and which recording were
    // running, and pig's client adds the time. See docs/events.md for every
    // type and its fields.
    logEvent(type: string, fields: Record<string, unknown> = {}, level: Level = "info"): void {
        sendEvent(this.event(type, fields, level));
    }

    // An event's data, as logEvent() sends it.
    event(type: string, fields: Record<string, unknown> = {}, level: Level = "info"): Record<string, unknown> {
        return {type, level, module: this.currentModuleName(), recording: this.currentRecording, ...fields};
    }

    // Numbers a new recording and makes it the current one.
    startRecording(): number {
        this.recordings += 1;
        this.currentRecording = this.recordings;
        // So a revisit doesn't number another recording the same.
        this.saveProgress();
        return this.recordings;
    }

    // Logs that a module's screen has started, with its items, and saves it as
    // where a revisit goes back to. Returns the index of the item to start at:
    // 0, unless the module was cut off partway.
    startModule(): number {
        const first = this.calibrating ? 0 : this.currentItem;
        this.logEvent("module_started", {
            items: this.calibrating ? [] : this.getCurrentModuleArgs(),
            item_index: first,
            face_check_only: this.resuming,
        });
        this.saveProgress();
        return first;
    }

    // Marks the current module's next item as done: a revisit goes on from
    // the one after it.
    finishItem(): void {
        this.currentItem += 1;
        this.saveProgress();
    }

    complete(): void {
        this.logEvent("session_finished");
        this.isCompleted = true;
    }

    hasExpired(): boolean {
        return this.expirationTime != null && this.expirationTime > 0 && this.expirationTime < new Date().getTime();
    }

    hasMoreModules(): boolean {
        return this.modules.length > this.currentModule + 1;
    }

    navigateToNextModule(navigate): void {
        this.logEvent("module_finished");
        this.calibrating = false;
        // Resuming goes to the item the module was cut off at.
        if (!this.resuming) {
            this.currentItem = 0;
        }
        this.resuming = false;
        if (this.hasMoreModules()) {
            this.currentModule += 1;
            const moduleName = this.modules[this.currentModule].module;
            navigate("/"+moduleName);
        } else {
            // Past the last module, so the end screen's events have no module.
            this.currentModule = this.modules.length;
            navigate("/end");
        }
    }

    // The running module's name, "calibration" during calibration, or null
    // before that (the intro) and after the last module (the end screen).
    currentModuleName(): string | null {
        if (this.calibrating) {
            return "calibration";
        }
        return this.modules[this.currentModule]?.module ?? null;
    }

    getCurrentModuleArgs(): string[] {
        return this.modules[this.currentModule].args
    }
}

// An error's name, message, and the start of its stack, for an event.
export const CurrentSessionData = new SessionData();
// Shared components log through log.ts; in a session, their events are the session's.
setEventSink((type, fields, level) => CurrentSessionData.logEvent(type, fields, level));

const pageStatus = {
    canLeave:false
}
export function setCanLeavePageSafely() {
    pageStatus.canLeave = true
}
window.addEventListener("beforeunload", function (e) {
    console.log("beforeunload", pageStatus.canLeave);
    if (pageStatus.canLeave) {
        return null;
    }
    e.preventDefault()
    e.returnValue = "Please don't leave in the middle of a session!";
    return "Please don't leave in the middle of a session!";
});
