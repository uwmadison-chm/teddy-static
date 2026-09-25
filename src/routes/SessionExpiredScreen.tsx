import {useEffect, useRef} from "react";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {setCanLeavePageSafely} from "@/data/sessionData.tsx";


export default function SessionExpiredScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);

    useEffect(() => {
        setCanLeavePageSafely()
        teddyRef.current?.showTextSequence(TeddyAnimations.SADNESS,
          [
              "Oh no, this session has expired!",
              "Please try to do your sessions during your given time windows.",
              "If you need further help, please contact your study coordinator.",
              "I'll see you in your next session!",
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
