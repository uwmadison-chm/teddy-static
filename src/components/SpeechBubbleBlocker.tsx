import { useEffect, useState } from "react";
import emitter from "tiny-emitter/instance";

const SpeechBubbleBlocker = () => {
    const [isUp, setIsUp] = useState(false);

    useEffect(() => {
        emitter.on("speechbubblestatus", (isShown: boolean) => {
            setIsUp(isShown);
            if ('ontouchstart' in window) {
                window.document.body.ontouchstart = (e: TouchEvent) => {
                    emitter.emit("speechbubbleblockerclicked");
                }
            } else {
                window.document.body.onclick = (e: PointerEvent) => {
                    if (e.pointerType) {
                        emitter.emit("speechbubbleblockerclicked");
                    }
                }
            }
        });
        return () => {
            emitter.off("speechbubblestatus");
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
//                  emitter.emit("speechbubbleblockerclicked");
//              }}
//         >
//     </div>
// );
};

export default SpeechBubbleBlocker;
