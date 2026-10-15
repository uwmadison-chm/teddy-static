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
} from "@rive-app/react-webgl2";
import {SpeechBubble, type SpeechBubbleFunctions} from "@/components/SpeechBubble.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {prefersReducedMotion} from "@/utils/utils.tsx";

// With reduced motion, Teddy holds still this long after starting an
// animation. Motion that runs longer than 5 seconds next to other content
// needs a way to stop it (WCAG 2.2.2).
const REDUCED_MOTION_PLAY_MS = 4000;

export interface TeddyProps {
    initialAnimation?: string,
    initialText?: string;
    onComplete?: () => void;
    isSmallTeddy?: boolean;
    textStyleOverride?: object;
    bubbleStyleOverride?: object;
}

export interface TeddyFunctions {
    showText: (animation:string|null, text: string, autoShow?: boolean, callback?: () => void, maxTimeout?: number) => void;
    showTextSequence: (animation:string|null, textArray: Array<string>, callback?: () => void, maxTimeout?: number) => void;
    blockerTapped: () => void;
    hideTextbox: () => void;
    showTextbox: () => void;
    playAnimation:(animation:string) => void;
}

export const Teddy = React.forwardRef<TeddyFunctions, TeddyProps>(({initialAnimation, isSmallTeddy, ...textBubblesProps}, ref) => {

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
        showText: (animation, newText, skipAnimation=false, callback, maxTextDuration) => {
            playAnimation(animation)

            if (speechBubbleRef.current != null) {
                speechBubbleRef.current.showText(newText, skipAnimation, callback, maxTextDuration)
            }
        },
        showTextSequence: (animation, textArray, callback, maxTextDuration) => {
            playAnimation(animation)

            if (speechBubbleRef.current != null) {
                speechBubbleRef.current.showTextSequence(textArray, callback, maxTextDuration)
            }
        },
        playAnimation: (animation) => {
            playAnimation(animation);
        },
        blockerTapped: () => {
            if (speechBubbleRef.current != null) {
                speechBubbleRef.current.blockerTapped();
            }
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
            <div className={"teddy-frame"} aria-hidden={true}>
                <RiveComponent
                    className='teddy-canvas' />
            </div>
            <div className={"speechbubble-slot"}>
                <SpeechBubble ref={speechBubbleRef} {...textBubblesProps} />
            </div>

        </div>
    )
});
