import * as React from "react";
import {useImperativeHandle, useRef} from "react";

export interface MicrophoneLevelIndicatorProps {
    blah?: number;
}

export interface MicrophoneLevelIndicatorFunctions {
    start: () => void;
    stop: () => void;
}

export const MicrophoneLevelIndicator = React.forwardRef<MicrophoneLevelIndicatorFunctions, MicrophoneLevelIndicatorProps>((props, ref) => {

    const [volume, setVolume] = React.useState(0);
    const [slowVolume, setSlowVolume] = React.useState(0);

    useImperativeHandle(ref, () => ({
        start: () => {
            const videoInput = document.getElementById('userVideo') as HTMLVideoElement
            const mediaStream = videoInput.srcObject as MediaStream

            const audioContext = new AudioContext();
            const mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
            const processor = audioContext.createScriptProcessor(2048, 1, 1);

            // mediaStreamSource.connect(audioContext.destination);
            mediaStreamSource.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = function (e) {
                const inputData = e.inputBuffer.getChannelData(0);
                const inputDataLength = inputData.length;
                let total = 0;

                for (let i = 0; i < inputDataLength; i++) {
                    total += Math.abs(inputData[i++]);
                }

                const rms = Math.sqrt(total / inputDataLength);
                setVolume(rms * 100);
                setSlowVolume(slowVolume * .95 + rms * 100 * .05);
            };

        },
        stop: () => {
        },
    }));

    return (
        <div className={"microphone-level-indicator"}
        style={{
        }}>
            <div className={"indicator"}>
                <div className={"level"} style={{height:(volume*4.5)+"%"}}></div>
            </div>
        </div>
    )
});
