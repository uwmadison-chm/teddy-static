import {useRef} from "react";
import {useScript} from "@/utils/script.ts";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {FadingPanelSet, type FadingPanelFunctions} from "@/components/FadingPanelSet.tsx";
import {WAY_OUT_PANEL, WayOutPanel} from "@/components/WayOutPanel.tsx";
import {endSessionEarly, showWayOut} from "@/utils/wayOut.ts";


export default function SessionExpiredScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);

    useScript(async (signal) => {
        const ended = endSessionEarly();
        await teddyRef.current.say(TeddyAnimations.SADNESS, [
            "Oh no, this session has expired!",
            "Please try to do your sessions during your given time windows.",
            "If you need further help, please contact your study coordinator.",
            "I'll see you in your next session!",
        ], signal);
        await showWayOut(teddyRef.current, fadingPanelRef.current, ended, signal);
    });

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />
            <FadingPanelSet ref={fadingPanelRef}>
                <WayOutPanel label={WAY_OUT_PANEL} />
            </FadingPanelSet>
        </div>
    );
}
