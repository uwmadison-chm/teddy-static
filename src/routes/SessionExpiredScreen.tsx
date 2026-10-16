import {useRef} from "react";
import {useScript} from "@/utils/script.ts";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {setCanLeavePageSafely} from "@/data/sessionData.tsx";
import {stopCameraStream} from "@/data/camera.ts";


export default function SessionExpiredScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);

    useScript(async (signal) => {
        setCanLeavePageSafely()
        stopCameraStream()
        await teddyRef.current.say(TeddyAnimations.SADNESS, [
            "Oh no, this session has expired!",
            "Please try to do your sessions during your given time windows.",
            "If you need further help, please contact your study coordinator.",
            "I'll see you in your next session!",
        ], signal);
        teddyRef.current.playAnimation(TeddyAnimations.WAVE)
    });

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />

        </div>
    );
}
