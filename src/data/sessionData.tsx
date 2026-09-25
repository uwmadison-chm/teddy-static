import axios from "axios";
import {removeItem} from "@/utils/utils.tsx";

class EventLogItem {
    timestamp: number;
    event: string;
    extras?: string;

    constructor(event: string, extras?: string) {
        this.timestamp = new Date().getTime();
        this.event = event;
        this.extras = extras;
    }
}

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

class ReelsRating {
    reelID: string;
    rating: number;

    constructor(reelID: string, rating: number) {
        this.reelID = reelID;
        this.rating = rating;
    }
}

const previousServerUploads = []

class SessionData {
    participantID: string;
    studyID: string;
    sessionID: string;
    expirationTime?: number;
    nextURL?: string;
    getParams: string;

    startTimestamp: number;
    endTimestamp?: number;
    timezone: string;
    sessionUUID: string;
    isCompleted: boolean;

    recordingUUIDs: string[];
    events: EventLogItem[];
    modules: ModuleParam[];
    reelsRatings: ReelsRating[];
    currentModule: number;

    constructor() {
        const url = window.location;
        const params = new URLSearchParams(url.search);
        this.participantID = params.get("participantID") || "";
        this.studyID = params.get("studyID") || "";
        this.sessionID = params.get("sessionID") || "";
        this.expirationTime = parseInt(params.get("expirationTime"));
        this.nextURL = params.get("nextURL");
        this.getParams = window.location.search;

        this.startTimestamp = new Date().getTime();
        this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        this.sessionUUID = crypto.randomUUID();
        this.isCompleted = false;

        this.recordingUUIDs = [];
        this.events = [];
        this.modules = [];
        this.reelsRatings = [];
        this.currentModule = -1;

        const modulesText = params.get("modules") || `${ModuleNames.Reels}|${ModuleNames.Sentence}|${ModuleNames.VideoLog}`;
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
            this.modules = [new ModuleParam("videolog", []), new ModuleParam("sentence", []), new ModuleParam("reels", [])];
        }
        console.log("Starting session with modules", this.modules);

    }

    logEvent(eventName:string, extras?:string) : void {
        this.events.push(new EventLogItem(
            eventName,
            extras,
        ))
    }

    complete(): void {
        this.endTimestamp = new Date().getTime();
        this.isCompleted = true;
    }

    hasExpired(): boolean {
        return this.expirationTime != null && this.expirationTime > 0 && this.expirationTime < new Date().getTime();
    }

    hasMoreModules(): boolean {
        return this.modules.length > this.currentModule + 1;
    }

    navigateToNextModule(navigate): void {
        const oldModuleName = this.currentModule >= 0 ? this.modules[this.currentModule].module : "Calibration";
        this.uploadToServer(oldModuleName + "Complete")
        if (this.hasMoreModules()) {
            this.currentModule += 1;
            const moduleName = this.modules[this.currentModule].module;
            navigate("/"+moduleName);
        } else {
            navigate("/end");
        }
    }

    getCurrentModuleArgs(): string[] {
        return this.modules[this.currentModule].args
    }

    uploadToServer(uploadID:string, onComplete?:()=>void):void {
        const uniqueID = `${this.currentModule}|${uploadID}`
        if (!previousServerUploads.includes(uniqueID)) {
            previousServerUploads.push(uniqueID);

            axios.post("/api/save_session/", {
                    participantId: this.participantID,
                    sessionData: this,
                    sessionUUID: this.sessionUUID,
                    uploadTimestamp: new Date().getTime(),
                })
                .then(function (response) {
                    if (onComplete) {
                        onComplete();
                    }
                })
                .catch(function (error) {
                    console.log(error);
                    removeItem(previousServerUploads, uniqueID);
                    CurrentSessionData.uploadToServer(uploadID, onComplete);
                })
        }
    }

    rateReel(reelID:string, rating:number): void {
        this.reelsRatings.push(new ReelsRating(reelID, rating));
    }
}

export const CurrentSessionData = new SessionData();

const pageStatus = {
    canLeave:false
}
export function SetCanLeavePageSafely() {
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
