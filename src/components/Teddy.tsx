import * as React from "react";
import teddyRivUrl from "@/assets/rive/teddy.riv?url";
import {useCallback, useEffect, useImperativeHandle, useRef} from "react";
import {
    Fit,
    Layout,
    type StateMachineInput,
    StateMachineInputType,
    useRive,
    useStateMachineInput
} from "@rive-app/react-canvas-lite";
import {SpeechBubble, type SpeechBubbleFunctions} from "@/components/SpeechBubble.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {prefersReducedMotion} from "@/utils/utils.tsx";
import {abortable} from "@/utils/script.ts";
import {CurrentSessionData} from "@/data/sessionData.tsx";

// With reduced motion, Teddy holds still this long after starting an
// animation. Motion that runs longer than 5 seconds next to other content
// needs a way to stop it (WCAG 2.2.2).
const REDUCED_MOTION_PLAY_MS = 4000;

export interface TeddyProps {
    initialAnimation?: string,
    isSmallTeddy?: boolean;
    // Shown beside a small Teddy, like the participant's video
    children?: React.ReactNode;
}

export interface SayOptions {
    // Show the line all at once rather than typing it out.
    skipAnimation?: boolean;
}

export interface TeddyFunctions {
    // Plays `animation` and says `lines` in the speech bubble, one at a time.
    // Resolves when the last line is all showing, or when Teddy is given
    // something else to say first. With a signal, rejects with Aborted when it
    // fires.
    say: (animation: string | null, lines: string | string[], signal?: AbortSignal, options?: SayOptions) => Promise<void>;
    hideTextbox: () => void;
    showTextbox: () => void;
    playAnimation:(animation:string) => void;
}

export const Teddy = React.forwardRef<TeddyFunctions, TeddyProps>(({initialAnimation, isSmallTeddy, children}, ref) => {

    const stateMachineAnimations = useRef({} as { [id: string] : StateMachineInput; })
    const speechBubbleRef = useRef<SpeechBubbleFunctions>(null)

    const { RiveComponent, rive, canvas } = useRive({
        src: teddyRivUrl,
        stateMachines: 'teddy',
        layout: new Layout({
            fit: Fit.Fill, // Specify Fit.Layout to automatically resize the artboard.
            layoutScaleFactor: 1,
        }),
        autoplay: true,
    })
    const initialStateMachineInput = useStateMachineInput(rive, "teddy", initialAnimation)

    const riveRef = useRef<typeof rive>(null)
    const stillTimeoutRef = useRef<number | null>(null)

    // Lets an animation play, then, with reduced motion, stops Teddy shortly after.
    const playThenHoldStill = useCallback(() => {
        const r = riveRef.current;
        if (r == null || !prefersReducedMotion()) {
            return;
        }
        if (stillTimeoutRef.current != null) {
            clearTimeout(stillTimeoutRef.current);
        }
        r.play();
        stillTimeoutRef.current = window.setTimeout(() => {
            stillTimeoutRef.current = null;
            r.pause();
        }, REDUCED_MOTION_PLAY_MS);
    }, [])

    useEffect(() => {
        riveRef.current = rive;
        playThenHoldStill();
        return () => {
            if (stillTimeoutRef.current != null) {
                clearTimeout(stillTimeoutRef.current);
                stillTimeoutRef.current = null;
            }
        };
    }, [rive, playThenHoldStill])

    function resetAnimationState(animationName) {
        if (stateMachineAnimations.current[animationName] != null) {

            stateMachineAnimations.current[animationName].value = false;
        }
    }

    const playAnimation = useCallback((animationName:string|null) => {
        playThenHoldStill()
        resetAnimationState(TeddyAnimations.PEERING)
        resetAnimationState(TeddyAnimations.WATCH_MOVIE)
        resetAnimationState(TeddyAnimations.LISTEN)

        const animationTrigger = stateMachineAnimations.current[animationName]

        // console.log(animationTrigger, "trying to trigger animation", animationName)

        if (animationTrigger != null && animationTrigger.type == StateMachineInputType.Boolean) {

            animationTrigger.value = true;
        } else {
            animationTrigger?.fire()
        }
    }, [playThenHoldStill])

    useEffect(() => {
        const allAnimations: { [id: string]: StateMachineInput; } = {}
        const stateMachineAnimationsList = rive?.stateMachineInputs('teddy')
        if (stateMachineAnimationsList) {
            for (const animation of stateMachineAnimationsList) {
                allAnimations[animation.name] = animation
            }
        }
        stateMachineAnimations.current = allAnimations

    }, [rive, canvas])

    useEffect(() => {
        // console.log(initialStateMachineInput, "trying to trigger initial teddy state")
        if (initialStateMachineInput != null && initialStateMachineInput?.type == StateMachineInputType.Boolean) {

            initialStateMachineInput.value = true
        } else {
            initialStateMachineInput?.fire()
        }
    }, [initialStateMachineInput]);

    useImperativeHandle(ref, () => ({
        say: (animation, lines, signal, options) => {
            playAnimation(animation)
            const all = typeof lines == "string" ? [lines] : [...lines];
            // Each line goes to pig as it starts to show, so the video shows
            // what Teddy was saying when.
            const said = speechBubbleRef.current?.say(all, options?.skipAnimation, (index) => {
                CurrentSessionData.logEvent("teddy_said", {
                    text: all[index],
                    line: index + 1,
                    lines: all.length,
                    animation: animation,
                });
            }) ?? Promise.resolve();
            return signal ? abortable(said, signal) : said;
        },
        playAnimation: (animation) => {
            playAnimation(animation);
        },
        hideTextbox: () => {
            if (speechBubbleRef.current != null) {
                speechBubbleRef.current.hide();
            }
        },
        showTextbox: () => {
            if (speechBubbleRef.current != null) {
                speechBubbleRef.current.show();
            }
        }
    }));


    return (
        <div className={"teddy " + (isSmallTeddy ? "small" : "")}>
            <div className={"teddy-row"}>
                <div className={"teddy-frame"} aria-hidden={true}>
                    <RiveComponent
                        className='teddy-canvas' />
                </div>
                {children}
            </div>
            <div className={"speechbubble-slot"}>
                <SpeechBubble ref={speechBubbleRef} />
            </div>

        </div>
    )
});
