import * as React from "react";
import {useEffect, useImperativeHandle, useRef} from "react";

export interface MicrophoneLevelIndicatorFunctions {
    start: () => void;
    stop: () => void;
}

// Levels at or below this many decibels show as an empty meter; 0 dB is full.
const FLOOR_DB = -60;
// How much of the previous level carries into the next frame as the level falls.
// Rising levels show at once; falling ones ease off, so the meter doesn't flicker.
const DECAY = 0.85;

export const MicrophoneLevelIndicator = React.forwardRef<MicrophoneLevelIndicatorFunctions>((_props, ref) => {

    const [level, setLevel] = React.useState(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const shownLevelRef = useRef(0);

    function stop() {
        if (animationFrameRef.current != null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (audioContextRef.current != null) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
    }

    function start() {
        stop();
        const videoInput = document.getElementById('userVideo') as HTMLVideoElement
        const mediaStream = videoInput.srcObject as MediaStream

        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        audioContext.createMediaStreamSource(mediaStream).connect(analyser);
        audioContextRef.current = audioContext;

        const samples = new Float32Array(analyser.fftSize);
        const update = () => {
            analyser.getFloatTimeDomainData(samples);
            let sumOfSquares = 0;
            for (const sample of samples) {
                sumOfSquares += sample * sample;
            }
            const rms = Math.sqrt(sumOfSquares / samples.length);
            const db = 20 * Math.log10(Math.max(rms, 1e-6));
            const newLevel = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));

            shownLevelRef.current = Math.max(newLevel, shownLevelRef.current * DECAY);
            setLevel(shownLevelRef.current);
            animationFrameRef.current = requestAnimationFrame(update);
        };
        animationFrameRef.current = requestAnimationFrame(update);
    }

    useEffect(() => {
        return stop;
    }, []);

    useImperativeHandle(ref, () => ({
        start: start,
        stop: stop,
    }));

    return (
        <div className={"microphone-level-indicator"}>
            <div className={"indicator"}>
                <div className={"level"} style={{height:(level*100)+"%"}}></div>
            </div>
        </div>
    )
});
