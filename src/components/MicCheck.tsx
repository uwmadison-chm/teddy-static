import * as React from "react";
import {useImperativeHandle, useRef, useState} from "react";
import {FaCheck} from "react-icons/fa";
import * as events from "@/utils/events.tsx";
import {abortable, sleep} from "@/utils/script.ts";
import {type Hop, listen} from "@/utils/vad/voiceListener.ts";
import {errorFields} from "@/data/sessionData.tsx";

// The words the participant says. Each lights up in turn as they talk.
const WORDS = ["Hi,", "Teddy!"];
// How much speech it takes to light each word, in milliseconds. "Hi" alone is
// a few hundred; the detector also needs a moment to be sure.
const WORD_MS = [128, 384];
// A 32 ms block counts as speech when the detector is at least this sure and
// it's at least this loud, in dB below full scale. Below that, the
// microphone is too far away or too quiet to record a voice well.
const SPEECH_CHANCE = 0.5;
const MIN_SPEECH_DB = -55;
// Each block of the voice detector's.
const HOP_MS = 32;
// A pause between words drains the count this much per block, so a long pause
// starts over but the gap between "Hi" and "Teddy" doesn't.
const PAUSE_MS = 16;
// How long to listen without hearing the words before Teddy gives tips.
const TROUBLE_AFTER_MS = 5000;
// With no audio at all this long, the browser isn't letting us hear it.
const NO_AUDIO_MS = 3000;
// How long ready() waits for listening to start.
const READY_WAIT_MS = 3000;

// What the mic check found, for the event log.
export type MicCheckSummary = {
    // The typical level, in dB below full scale, and how much of it the
    // detector took for speech, while listening before the check (during the
    // face check). null with nothing heard then.
    background_db: number | null;
    background_speech: number | null;
    // The typical level of the blocks that counted as speech during the check;
    // null if none did.
    speech_db: number | null;
    // The loudest block during the check.
    peak_db: number | null;
    // How much speech the check counted, at its most; WORD_MS's last is enough.
    voiced_ms: number;
    tips_shown: boolean;
    // The rate the browser's audio runs at; null if listening never started.
    sample_rate: number | null;
    // Each time listening failed: `stage` is "listen" (the detector wouldn't
    // load or the browser wouldn't give us the audio) or "no_audio" (it
    // started but no audio came).
    errors: ({stage: string} & ReturnType<typeof errorFields>)[];
};

export interface MicCheckResult {
    heard: boolean;
    // False when the check couldn't listen at all.
    available: boolean;
}

export interface MicCheckOptions {
    // Called once, if the words haven't been heard for a while.
    onTrouble?: () => void;
}

export interface MicCheckFunctions {
    // Starts listening to `stream`'s microphone, which measures the background
    // until check() starts. Listening stops with hide() or when `signal` fires.
    startListening: (stream: MediaStream, signal: AbortSignal) => void;
    // Resolves to whether listening started, waiting a few seconds at most.
    ready: (signal: AbortSignal) => Promise<boolean>;
    // Shows the words and listens until they've been heard. Stops when `signal`
    // fires.
    check: (signal: AbortSignal, options?: MicCheckOptions) => Promise<MicCheckResult>;
    summary: () => MicCheckSummary;
    hide: () => void;
}

function median(values: number[]): number | null {
    if (values.length == 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function round(value: number | null): number | null {
    return value == null ? null : Math.round(value * 10) / 10;
}

export const MicCheck = React.forwardRef<MicCheckFunctions>((_props, ref) => {
    const [isShown, setIsShown] = useState(false);
    const [isFadingOut, setIsFadingOut] = useState(false);
    // How many of WORDS are lit.
    const [lit, setLit] = useState(0);

    const listening = useRef<Promise<boolean> | null>(null);
    const stopListening = useRef<AbortController | null>(null);
    // Where each heard block goes: the background until check() starts, then
    // the check.
    const onHop = useRef<(hop: Hop) => void>(() => {});
    const background = useRef<Hop[]>([]);
    const summary = useRef<MicCheckSummary>({
        background_db: null, background_speech: null, speech_db: null, peak_db: null,
        voiced_ms: 0, tips_shown: false, sample_rate: null, errors: [],
    });

    function startListening(stream: MediaStream, signal: AbortSignal) {
        stopListening.current?.abort();
        const controller = new AbortController();
        stopListening.current = controller;
        signal.addEventListener("abort", () => controller.abort(), {once: true});
        background.current = [];
        onHop.current = (hop) => {
            // A minute is plenty, and keeps a long face check from piling up.
            if (background.current.length < 2000) {
                background.current.push(hop);
            }
        };
        listening.current = listen(stream, (hop) => onHop.current(hop), controller.signal)
            .then(({sampleRate}) => {
                summary.current.sample_rate = sampleRate;
                return true;
            }, (error) => {
                console.error("Couldn't listen to the microphone:", error);
                summary.current.errors.push({stage: "listen", ...errorFields(error)});
                return false;
            });
    }

    async function ready(signal: AbortSignal): Promise<boolean> {
        if (listening.current == null) {
            return false;
        }
        return abortable(Promise.race([listening.current, sleep(READY_WAIT_MS, signal).then(() => false)]), signal);
    }

    async function check(signal: AbortSignal, options: MicCheckOptions = {}): Promise<MicCheckResult> {
        const heard = background.current;
        summary.current.background_db = round(median(heard.map(h => h.db)));
        summary.current.background_speech = heard.length ? Math.round(heard.filter(h => h.speech > SPEECH_CHANCE).length / heard.length * 100) / 100 : null;
        setLit(0);
        setIsShown(true);
        setIsFadingOut(false);
        if (!await abortable(listening.current ?? Promise.resolve(false), signal)) {
            return {heard: false, available: false};
        }

        let voicedMs = 0;
        let lastHop = Date.now();
        const speechDbs: number[] = [];
        const started = Date.now();
        let finish: (result: MicCheckResult) => void;
        const done = new Promise<MicCheckResult>((resolve) => finish = resolve);
        onHop.current = (hop) => {
            lastHop = Date.now();
            const s = summary.current;
            s.peak_db = round(Math.max(s.peak_db ?? -Infinity, hop.db));
            if (hop.speech > SPEECH_CHANCE && hop.db > MIN_SPEECH_DB) {
                voicedMs += HOP_MS;
                speechDbs.push(hop.db);
                s.speech_db = round(median(speechDbs));
            } else {
                voicedMs = Math.max(0, voicedMs - PAUSE_MS);
            }
            s.voiced_ms = Math.max(s.voiced_ms, voicedMs);
            // Once lit, a word stays lit.
            setLit(n => Math.max(n, WORD_MS.filter(ms => s.voiced_ms >= ms).length));
            if (s.voiced_ms >= WORD_MS[WORD_MS.length - 1]) {
                finish({heard: true, available: true});
            }
        };
        try {
            for (;;) {
                const result = await abortable(Promise.race([done, sleep(250, signal).then(() => null)]), signal);
                if (result != null) {
                    events.announce("Heard you");
                    return result;
                }
                if (Date.now() - lastHop > NO_AUDIO_MS) {
                    summary.current.errors.push({stage: "no_audio", ...errorFields(new Error("No audio came from the microphone"))});
                    return {heard: false, available: false};
                }
                if (!summary.current.tips_shown && Date.now() - started > TROUBLE_AFTER_MS) {
                    summary.current.tips_shown = true;
                    options.onTrouble?.();
                }
            }
        } finally {
            onHop.current = () => {};
        }
    }

    useImperativeHandle(ref, () => ({
        startListening,
        ready,
        check,
        summary: () => ({...summary.current, errors: [...summary.current.errors]}),
        hide: () => {
            stopListening.current?.abort();
            // Leave the words up long enough to read as confirmation.
            setTimeout(() => {
                setIsFadingOut(true);
                setTimeout(() => setIsShown(false), 300);
            }, 1200);
        },
    }));

    const allLit = lit >= WORDS.length;
    return (
        <div className={"mic-check" + (isFadingOut ? " faded" : "")} hidden={!isShown}>
            <p className={"words"}>
                {WORDS.map((word, i) => (
                    <span key={word} className={"word" + (i < lit ? " lit" : "")}>{word}</span>
                ))}
                <span className={"check" + (allLit ? " shown" : "")} aria-hidden={true}><FaCheck /></span>
            </p>
        </div>
    );
});
