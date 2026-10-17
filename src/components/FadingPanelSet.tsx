import * as React from "react";
import {useEffect, useImperativeHandle, useRef, useState} from "react";
import {prefersReducedMotion} from "@/utils/utils.tsx";

export const FadingPanel = ({label, invisible = false, ...props}) => {
    return <div className={"fade-panel" + (invisible ? " invisible" : "")} {...props} />;
};

interface Props {
    children?: React.ReactNode;
}

// Each resolves once its animation is done. Its first button gets focus then.
export interface FadingPanelFunctions {
    // Fades the shown panel out and `label`'s in, or with null, leaves none showing.
    showPanel: (label: string | null) => Promise<void>;
    // Bounces `label`'s panel, or the default one, up from below.
    showStartPanel: (label?: string) => Promise<void>;
}

export const FADING_PANEL_DEFAULT_LABEL = "default"

export const FadingPanelSet = React.forwardRef<FadingPanelFunctions, Props>((props, ref) => {

    const [shownPanelkey, setShownPanelkey] = useState<string|null>(null);
    // The last panel shown. With none showing, it stays in place, invisible,
    // so the screen doesn't reflow when the next one comes in.
    const [laidOutKey, setLaidOutKey] = useState<string|null>(null);
    const [isDisplayed, setIsDisplayed] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);

    const animatedRef = useRef(null)

    // Panels bounce up from below and drop away, or with reduced motion, fade.
    function generateBounceKeyframes(initial:number, end:number) {
        if (prefersReducedMotion()) {
            return [
                {opacity: initial == 0 ? 1 : 0, offset:0},
                {opacity: end == 0 ? 1 : 0, offset:1},
            ]
        }
        return [
            {transform:`translateY(${initial}px)`, offset:0},
            {transform:`translateY(${end}px)`, offset:1},
        ]
    }

    // Set when a panel is shown, so its first button gets focus once it's done
    // animating in. Keyboard and screen reader users would otherwise be left on
    // the button they just pressed, which is now hidden.
    // Focusing it also scrolls it into view, if the screen is scrolled.
    const focusPendingRef = useRef(false);

    // Counts panel changes, so when one starts before the last has finished,
    // as when Enter skips Teddy's typing just after an answer, only the latest
    // one's timers change what's shown or end the animation. Otherwise the
    // earlier one ends it first, and the focus above never happens.
    const changeRef = useRef(0);

    useEffect(() => {
        if (!focusPendingRef.current || isAnimating) {
            return;
        }
        focusPendingRef.current = false;
        const shown = Array.from(animatedRef.current?.children ?? []) as HTMLElement[];
        const panel = shown.find((child) => !child.hidden && !child.classList.contains("invisible"));
        panel?.querySelector("button")?.focus();
    }, [isAnimating]);

    const showStartPanel = (panelName?: string) => new Promise<void>((resolve) => {
        const change = ++changeRef.current;
        const animateDuration = 600
        setIsAnimating(true);
        setIsDisplayed(true);
        setShownPanelkey(panelName || FADING_PANEL_DEFAULT_LABEL);
        setLaidOutKey(panelName || FADING_PANEL_DEFAULT_LABEL);
        focusPendingRef.current = true;
        animatedRef.current!.animate(generateBounceKeyframes(1000, 0),
            {
                duration: animateDuration,
                easing: "cubic-bezier(.61,1.58,.57,.87)",
                fill: "both",
            })
        setTimeout(()=> {
            if (change == changeRef.current) {
                setIsAnimating(false)
            }
            resolve()
        }, animateDuration)
    });
    const showPanel = (panelLabel: string | null) => new Promise<void>((resolve) => {
        const change = ++changeRef.current;
        const fadeOutDuration = 300
        const fadeInDuration = 200
        setIsAnimating(true);
        animatedRef.current!.animate([{opacity:1}, {opacity:0}],
            {
                duration: fadeOutDuration,
                easing: "ease-in",
                fill: "both",
            })
        setTimeout(()=> {
            if (change != changeRef.current) {
                resolve()
                return
            }

            setShownPanelkey(panelLabel);
            if (panelLabel != null) {
                setLaidOutKey(panelLabel);
                focusPendingRef.current = true;
            }

            animatedRef.current!.animate([{opacity:0}, {opacity:1}],
                {
                    duration: fadeOutDuration,
                    easing: "ease-in",
                    fill: "both",
                })
            setTimeout(()=> {
                if (change == changeRef.current) {
                    setIsAnimating(false)
                }
                resolve()
            }, fadeInDuration)
        }, fadeOutDuration)
    });
    useImperativeHandle(ref, () => ({
        showPanel,
        showStartPanel,
    }));

    // Inert while animating, so a second press of Enter can't go through
    // the way pointer-events: none keeps a second tap from going through.
    return <div className={"fade-panel-set" + (isAnimating ? " uninteractive" : "")} inert={isAnimating} hidden={!isDisplayed}>
            <div ref={animatedRef} className={"animated"}>



        {React.Children.map(props.children, (child) => {

            if (React.isValidElement(child)) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                const { label } = child.props;

                const childNode = React.cloneElement(child, {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    hidden: !(label == laidOutKey && isDisplayed),
                    invisible: label != shownPanelkey,
                });
                return childNode;
            }
        })}
    </div>

    </div>;
});
