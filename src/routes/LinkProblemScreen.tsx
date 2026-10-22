import {useRef} from "react";
import {useScript} from "@/utils/script.ts";
import {useLocation} from "react-router";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {Config} from "@/data/config.ts";
import {FadingPanelSet, type FadingPanelFunctions} from "@/components/FadingPanelSet.tsx";
import {WAY_OUT_PANEL, WayOutPanel} from "@/components/WayOutPanel.tsx";
import {endSessionEarly, showWayOut} from "@/utils/wayOut.ts";


export interface LinkProblemState {
    // Why pig wouldn't start the run: a PigError code, or "unsupported"; or
    // "script-error" when a screen broke partway through the session. Absent
    // when the problem is in the link itself.
    code?: string;
}

// What to tell the participant, by what went wrong.
function explanation(code?: string): string[] {
    switch (code) {
        case "offline":
            return [
                "Oh no, I can't reach the server that saves your answers!",
                "Please check your internet connection, then reload this page.",
            ];
        case "task-closed":
            return [
                "Oh no, this activity isn't open right now!",
                "If you think it should be, please contact your study coordinator.",
            ];
        case "script-error":
            return [
                "Oh no, something went wrong on my end!",
                "It isn't anything you did.",
                "Reloading this page might help. If it doesn't, please contact your study coordinator.",
            ];
        case "unsupported":
            return [
                "Oh no, this browser can't save your answers the way I need it to!",
                "This can happen in a private window. Please try a regular window, or another browser.",
            ];
        default:
            return [
                "Oh no, something's wrong with the link that brought you here!",
                "It isn't anything you did.",
                "Please contact your study coordinator and let them know.",
            ];
    }
}

// Shown instead of the session when it can't go ahead: the link is wrong, pig
// wouldn't start a run for it, or a screen broke. What's wrong is in the
// console; the participant just needs to know it isn't their fault, what to
// do, and how to move on.
export default function LinkProblemScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);
    const location = useLocation();
    const state = (location.state || {}) as LinkProblemState;

    useScript(async (signal) => {
        const ended = endSessionEarly();
        await teddyRef.current.say(TeddyAnimations.SADNESS, explanation(state.code), signal);
        await showWayOut(teddyRef.current, fadingPanelRef.current, ended, signal);
    });

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />
            {/* What's wrong, for whoever made the link. Participants don't see this. */}
            {Config.debug && <div className={"debug-link-problems"}>
                <ul>
                    {state.code == "script-error" ?
                        <li>A screen's script failed; the console has the error</li> :
                    state.code ?
                        <li>pig wouldn't start the run: {state.code}</li> :
                        CurrentSessionData.linkProblems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
                <a href={"?links&check=" + encodeURIComponent(window.location.href)}
                   target={"_blank"} rel={"noreferrer"}>Check this link in the link builder</a>
            </div>}
            <FadingPanelSet ref={fadingPanelRef}>
                <WayOutPanel label={WAY_OUT_PANEL} />
            </FadingPanelSet>
        </div>
    );
}
