import {useEffect, useRef} from "react";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {setCanLeavePageSafely} from "@/data/sessionData.tsx";
import {stopCameraStream} from "@/data/camera.ts";


// Shown instead of the session when the link Teddy was opened with can't work.
// What's wrong is in the console and the session data; the participant just
// needs to know it isn't their fault and who to ask.
export default function LinkProblemScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);

    useEffect(() => {
        setCanLeavePageSafely()
        stopCameraStream()
        teddyRef.current?.showTextSequence(TeddyAnimations.SADNESS,
          [
              "Oh no, something's wrong with the link that brought you here!",
              "It isn't anything you did.",
              "Please contact your study coordinator and let them know.",
          ],
          () => {
              teddyRef.current?.playAnimation(TeddyAnimations.WAVE)
          }
        );
    }, [teddyRef]);

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />

        </div>
    );
}
