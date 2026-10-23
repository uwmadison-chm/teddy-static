// Screens run as scripts: async functions that say something, wait for the
// participant, record, and so on, one step after another. Each script gets an
// AbortSignal that fires when its screen goes away, and every step that waits
// takes that signal, so nothing a script started outlives its screen.

import {useEffect, useEffectEvent, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router";
import {CurrentSessionData, errorFields} from "@/data/sessionData.tsx";
import type {LinkProblemState} from "@/routes/LinkProblemScreen.tsx";

// Thrown out of a step whose script was stopped. useScript expects it.
export class Aborted extends Error {
    constructor() {
        super("Aborted");
        this.name = "Aborted";
    }
}

// Rejects with Aborted when `signal` fires, otherwise settles as `promise` does.
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(new Aborted());
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new Aborted());
        signal.addEventListener("abort", onAbort, {once: true});
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

// Waits `ms` milliseconds.
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.reject(new Aborted());
    }
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Aborted());
        };
        signal.addEventListener("abort", onAbort, {once: true});
    });
}

// Runs `steps` side by side, each with its own signal, and resolves with
// whichever finishes first. The rest are stopped then, so a step that was
// waiting to show a button doesn't show it after all.
export async function firstOf<T>(signal: AbortSignal, ...steps: ((signal: AbortSignal) => Promise<T>)[]): Promise<T> {
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener("abort", stop, {once: true});
    try {
        return await abortable(Promise.race(steps.map((step) => {
            const running = step(controller.signal);
            // The losers end with Aborted; nobody needs to hear about it.
            running.catch(() => {});
            return running;
        })), signal);
    } finally {
        signal.removeEventListener("abort", stop);
        controller.abort();
    }
}

// Runs `script` when the screen mounts, and stops it when the screen unmounts.
// A script that fails would leave the participant with nothing to press, so
// they go to the problem screen instead, which has a way out.
export function useScript(script: (signal: AbortSignal) => Promise<void>) {
    // The first render's script; screens don't swap scripts.
    const scriptRef = useRef(script);
    const navigate = useNavigate();
    const {pathname} = useLocation();
    const failed = useEffectEvent((error: unknown) => {
        console.error("Screen script failed:", error);
        CurrentSessionData.logEvent("uncaught_exception", errorFields(error), "error");
        // Unless it's the problem screen that failed.
        if (pathname != "/linkproblem") {
            const state: LinkProblemState = {code: "script-error"};
            navigate("/linkproblem", {state});
        }
    });
    useEffect(() => {
        const controller = new AbortController();
        scriptRef.current(controller.signal).catch((error) => {
            if (!(error instanceof Aborted)) {
                failed(error);
            }
        });
        return () => controller.abort();
    }, []);
}

// What the participant picks with a panel's buttons. The buttons call pick(),
// and the script waits for it with next(). A pick with nobody waiting, like a
// second press of the same button, is ignored.
export class Choice<T = void> {
    private waiting: ((value: T) => void) | null = null;

    next(signal: AbortSignal): Promise<T> {
        let waiting: (value: T) => void;
        return abortable(new Promise<T>((resolve) => {
            waiting = resolve;
            this.waiting = resolve;
        }), signal).finally(() => {
            if (this.waiting == waiting) {
                this.waiting = null;
            }
        });
    }

    pick(value: T): void {
        const waiting = this.waiting;
        this.waiting = null;
        waiting?.(value);
    }
}

// A Choice that lasts as long as the screen.
export function useChoice<T = void>(): Choice<T> {
    const [choice] = useState(() => new Choice<T>());
    return choice;
}
