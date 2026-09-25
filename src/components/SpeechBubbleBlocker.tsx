import { useEffect, useState } from "react";
import * as events from "@/utils/events.tsx";

const SpeechBubbleBlocker = () => {
    const [isUp, setIsUp] = useState(false);

    useEffect(() => {
        const off = events.on("speechbubblestatus", (isShown) => {
            setIsUp(isShown);
            if ('ontouchstart' in window) {
                window.document.body.ontouchstart = (e: TouchEvent) => {
                    events.emit("speechbubbleblockerclicked");
                }
            } else {
                window.document.body.onclick = (e: PointerEvent) => {
                    if (e.pointerType) {
                        events.emit("speechbubbleblockerclicked");
                    }
                }
            }
        });
        return () => {
            off();
            window.document.onclick = null;
        };
    }, []);

    return <div />;
//     if (!isUp) {
//         return <div />;
//     }
//
//     return (
//         <div style={{
//             position: "absolute",
//                 zIndex: 10000,
//                 top: 0,
//                 left: 0,
//                 bottom: 0,
//                 right: 0
//         }}
//              onClick={()=> {
//                  events.emit("speechbubbleblockerclicked");
//              }}
//         >
//     </div>
// );
};

export default SpeechBubbleBlocker;
