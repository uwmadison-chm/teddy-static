// How a screen that ends the session early lets the participant go: on to
// nextURL, when config.js allows it and the link has one, or else by telling
// them they can close the tab.

import type {FadingPanelFunctions} from "@/components/FadingPanelSet.tsx";
import type {TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {WAY_OUT_PANEL} from "@/components/WayOutPanel.tsx";
import {Config} from "@/data/config.ts";
import {CurrentSessionData, setCanLeavePageSafely} from "@/data/sessionData.tsx";
import * as pig from "@/data/pig.ts";
import {stopCameraStream} from "@/data/camera.ts";
import {abortable} from "@/utils/script.ts";

// How long to wait for what's left of the run to reach pig before showing the
// way out. Whatever hasn't arrived stays on the device, and pig's client sends
// it the next time Teddy runs there.
const SEND_WAIT_MS = 10_000;

// Turns the camera off and finishes the run, if there is one. Resolves once
// everything has reached pig, or after SEND_WAIT_MS, whichever is first. Never
// rejects. Start it early, so it's usually done by the time Teddy is.
export function endSessionEarly(): Promise<void> {
    stopCameraStream();
    const sent = pig.finishRun(() => {}).catch((error) => {
        console.error("Couldn't finish sending to pig:", error);
    });
    const waited = new Promise<void>((resolve) => window.setTimeout(resolve, SEND_WAIT_MS));
    return Promise.race([sent, waited]);
}

// Once `ended` (from endSessionEarly()) resolves, shows the way out: Teddy
// says to press the button and WayOutPanel comes up, or he says the tab can be
// closed.
export async function showWayOut(teddy: TeddyFunctions, panels: FadingPanelFunctions,
                                 ended: Promise<void>, signal: AbortSignal): Promise<void> {
    await abortable(ended, signal);
    setCanLeavePageSafely();
    if (Config.nextUrlAfterFailure && CurrentSessionData.nextURL) {
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY, "Press the button to continue.", signal);
        panels.showStartPanel(WAY_OUT_PANEL);
    } else {
        await teddy.say(TeddyAnimations.WAVE, "You can close this tab now.", signal);
    }
}

// For when the page itself breaks, as when a screen fails while React is
// drawing it: React takes everything off the page, Teddy included, so this
// puts up the problem screen's message and the way out in plain HTML.
export async function showPlainWayOut(): Promise<void> {
    await endSessionEarly();
    setCanLeavePageSafely();
    const page = document.createElement("main");
    page.className = "phone-screen-wrapper plain-way-out";
    const lines = [
        "Oh no, something went wrong on my end! It isn't anything you did.",
        "Reloading this page might help. If it doesn't, please contact your study coordinator.",
    ];
    for (const line of lines) {
        const p = document.createElement("p");
        p.textContent = line;
        page.append(p);
    }
    if (Config.nextUrlAfterFailure && CurrentSessionData.nextURL) {
        // Laid out like a FadingPanelSet, for its button style.
        const button = document.createElement("button");
        button.textContent = "Continue to Surveys";
        button.addEventListener("click", () => window.location.assign(CurrentSessionData.nextURL));
        const set = document.createElement("div");
        set.className = "fade-panel-set";
        set.innerHTML = `<div class="animated"><div class="fade-panel"></div></div>`;
        set.querySelector(".fade-panel").append(button);
        page.append(set);
    } else {
        const p = document.createElement("p");
        p.textContent = "You can close this tab now.";
        page.append(p);
    }
    document.getElementById("root").replaceChildren(page);
}
