import {allowedNextURL} from "@/data/config.ts";
import {TeddyReels} from "@/data/reels.ts";
import {sendEvent} from "@/data/pig.ts";

const ModuleNames = {
    Reels: "reels",
    Sentence: "sentence",
    VideoLog: "videolog",
}

class ModuleParam {
    module: string;
    args: string[];

    constructor(module: string, args: string[]) {
        this.module = module;
        this.args = args;
    }
}

// The session's state. What happens in it goes to pig as events, through
// logEvent(); the link's parameters reach pig when the run starts (see pig.ts).
class SessionData {
    expirationTime?: number;
    nextURL: string | null;
    isCompleted: boolean;

    modules: ModuleParam[];
    linkProblems: string[];
    currentModule: number;

    constructor() {
        const params = new URLSearchParams(window.location.search);
        this.expirationTime = parseInt(params.get("expirationTime"));
        this.nextURL = allowedNextURL(params.get("nextURL"));
        this.isCompleted = false;

        if (params.get("nextURL") && !this.nextURL) {
            console.warn("Ignoring nextURL; it isn't an allowed http(s) URL:", params.get("nextURL"));
            this.logEvent("nextURLRejected", params.get("nextURL"));
        }
        this.modules = [];
        this.currentModule = -1;

        // Reels aren't in the default: which reels to play has to come from the link.
        const modulesText = params.get("modules") || `${ModuleNames.Sentence}|${ModuleNames.VideoLog}`;
        for (const moduleText of modulesText.split("|")) {
            const parts = moduleText.split(":");
            const moduleName = parts[0].toLowerCase();
            if (Object.values(ModuleNames).includes(moduleName)) {
                const argsString = parts[1] || "";
                const args = argsString.split(",").filter(x => !!x);
                this.modules.push(new ModuleParam(moduleName, args))
            }
        }
        if (!this.modules.length) {
            this.modules = [new ModuleParam("videolog", []), new ModuleParam("sentence", [])];
        }

        // Problems with the link that mean the session can't run as asked.
        this.linkProblems = [];
        for (const module of this.modules) {
            if (module.module == ModuleNames.Reels) {
                if (!module.args.length) {
                    this.linkProblems.push("The reels module needs reel IDs, like reels:01,02");
                }
                for (const reelID of module.args) {
                    if (!(reelID in TeddyReels)) {
                        this.linkProblems.push(`There's no reel with ID ${reelID}`);
                    }
                }
            }
        }
        if (this.linkProblems.length) {
            console.error("Problems with this link:", this.linkProblems);
            this.logEvent("linkProblems", {problems: this.linkProblems});
        }
        console.log("Starting session with modules", this.modules);
        this.logEvent("sessionStarted", {modules: params.get("modules")});
    }

    // Sends an event to pig. `type` says what happened; `detail` is anything
    // else worth keeping. Each event also records which module was running, and
    // pig's client adds the time.
    logEvent(type: string, detail?: string | Record<string, unknown>): void {
        const event: Record<string, unknown> = {type: type, module: this.currentModuleName()};
        if (detail !== undefined) {
            event.detail = detail;
        }
        sendEvent(event);
    }

    complete(): void {
        this.logEvent("sessionComplete");
        this.isCompleted = true;
    }

    hasExpired(): boolean {
        return this.expirationTime != null && this.expirationTime > 0 && this.expirationTime < new Date().getTime();
    }

    hasMoreModules(): boolean {
        return this.modules.length > this.currentModule + 1;
    }

    navigateToNextModule(navigate): void {
        this.logEvent("moduleComplete");
        if (this.hasMoreModules()) {
            this.currentModule += 1;
            const moduleName = this.modules[this.currentModule].module;
            navigate("/"+moduleName);
        } else {
            navigate("/end");
        }
    }

    // The running module's name, or null before the first (intro and calibration).
    currentModuleName(): string | null {
        return this.currentModule >= 0 ? this.modules[this.currentModule].module : null;
    }

    getCurrentModuleArgs(): string[] {
        return this.modules[this.currentModule].args
    }
}

export const CurrentSessionData = new SessionData();

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
