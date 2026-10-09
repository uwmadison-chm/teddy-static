import {useEffect, useRef} from "react";
import {useLocation} from "react-router";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {setCanLeavePageSafely} from "@/data/sessionData.tsx";
import {stopCameraStream} from "@/data/camera.ts";


export interface LinkProblemState {
    // Why pig wouldn't start the run: a PigError code, or "unsupported".
    // Absent when the problem is in the link itself.
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

// Shown instead of the session when it can't go ahead: the link is wrong, or
// pig wouldn't start a run for it. What's wrong is in the console; the
// participant just needs to know it isn't their fault and what to do.
export default function LinkProblemScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);
    const location = useLocation();
    const state = (location.state || {}) as LinkProblemState;

    useEffect(() => {
        setCanLeavePageSafely()
        stopCameraStream()
        teddyRef.current?.showTextSequence(TeddyAnimations.SADNESS,
          explanation(state.code),
          () => {
              teddyRef.current?.playAnimation(TeddyAnimations.WAVE)
          }
        );
    }, [teddyRef, state.code]);

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />

        </div>
    );
}
