import * as React from "react";
import {type RefObject, useCallback, useEffect, useImperativeHandle, useRef} from "react";
import {
    Fit,
    Layout,
    type StateMachineInput,
    StateMachineInputType,
    useRive,
    useStateMachineInput
} from "@rive-app/react-webgl2";
import {SpeechBubble} from "@/components/SpeechBubble.tsx";

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

export const TeddyAnimations = {
    IDLE: "idle",
    WATCH_MOVIE: "watch_movie",
    WAVE: "wave",
    WAVE_SHORT: "wave_short",
    PEERING: "is_peering",
    SUCCESS: "success",
    SADNESS: "sadness",
    FAIL: "fail",
    HANDS_UP: "hands_up",
    HANDS_DOWN: "hands_down",
    SLIGHTLY_HAPPY: "slightly_happy",
    LISTEN: "is_listening",
}

export const Teddy = React.forwardRef<TeddyFunctions, TeddyProps>(({initialAnimation, isSmallTeddy, ...textBubblesProps}, ref) => {

    const stateMachineAnimations = useRef({} as { [id: string] : StateMachineInput; })
    const speechBubbleRef :RefObject<any> = useRef(null)

    const { RiveComponent, rive, canvas } = useRive({
        src: "static/rive/teddy.riv",
        stateMachines: 'teddy',
        layout: new Layout({
            fit: Fit.Fill, // Specify Fit.Layout to automatically resize the artboard.
            layoutScaleFactor: 1,
        }),
        autoplay: true,
    })
    const initialStateMachineInput = useStateMachineInput(rive, "teddy", initialAnimation)

    function resetAnimationState(animationName) {
        if (stateMachineAnimations.current[animationName] != null) {
            // eslint-disable-next-line react-hooks/immutability
            stateMachineAnimations.current[animationName].value = false;
        }
    }

    const playAnimation = useCallback((animationName:string|null) => {
        resetAnimationState(TeddyAnimations.PEERING)
        resetAnimationState(TeddyAnimations.WATCH_MOVIE)
        resetAnimationState(TeddyAnimations.LISTEN)

        const animationTrigger = stateMachineAnimations.current[animationName]

        // console.log(animationTrigger, "trying to trigger animation", animationName)

        if (animationTrigger != null && animationTrigger.type == StateMachineInputType.Boolean) {
            // eslint-disable-next-line react-hooks/immutability
            animationTrigger.value = true;
        } else {
            animationTrigger?.fire()
        }
    }, [])

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
            // eslint-disable-next-line react-hooks/immutability
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
            <div className={"teddy-frame"}>
                <RiveComponent
                    className='teddy-canvas' />
            </div>
            <SpeechBubble ref={speechBubbleRef} {...textBubblesProps} />

        </div>
    )
});
