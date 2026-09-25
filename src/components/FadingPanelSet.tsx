import * as React from "react";
import {useEffect, useImperativeHandle, useRef, useState} from "react";

export const FadingPanel = ({label, ...props}) => {
    return <div className={"fade-panel"} {...props} />;
};

interface Props {
    children?: React.ReactNode;
}

export interface FadingPanelFunctions {
    showPanel: (text: string, callback?:()=>void) => void;
    showStartPanel: (panelName?: string) => void;
    hide: (callback?: () => void) => void;
}

export const FADING_PANEL_DEFAULT_LABEL = "default"

export const FadingPanelSet = React.forwardRef<FadingPanelFunctions, Props>((props, ref) => {

    const [shownPanelkey, setShownPanelkey] = useState<string|null>(null);
    const [isDisplayed, setIsDisplayed] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);

    const animatedRef = useRef(null)

    function generateBounceKeyframes(initial:number, end:number) {
        return [
            {transform:`translateY(${initial}px)`, offset:0},
            {transform:`translateY(${end}px)`, offset:1},
        ]
    }

    const showStartPanel = (panelName) => {
        const animateDuration = 600
        setIsAnimating(true);
        setIsDisplayed(true);
        setShownPanelkey(panelName || FADING_PANEL_DEFAULT_LABEL);
        animatedRef.current!.animate(generateBounceKeyframes(1000, 0),
            {
                duration: animateDuration,
                easing: "cubic-bezier(.61,1.58,.57,.87)",
                fill: "both",
            })
        setTimeout(()=> {
            setIsAnimating(false)
        }, animateDuration)

    };
    const showPanel = async (panelLabel:string, callback:(()=>void)|null=null) => {

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

            setShownPanelkey(panelLabel);

            animatedRef.current!.animate([{opacity:0}, {opacity:1}],
                {
                    duration: fadeOutDuration,
                    easing: "ease-in",
                    fill: "both",
                })
            setTimeout(()=> {
                setIsAnimating(false)
                if (callback != null) {
                    callback()
                }

            }, fadeInDuration)
        }, fadeOutDuration)
    };
    const hide = async (callback:(()=>void)|null=null) => {

        const animateDuration = 600
        setIsAnimating(true);
        setIsDisplayed(true);
        setShownPanelkey(FADING_PANEL_DEFAULT_LABEL);
        animatedRef.current!.animate(generateBounceKeyframes(0, 1000),
            {
                duration: animateDuration,
                easing: "cubic-bezier(.4,.04,.37,-0.57)",
                fill: "both",
            })
        setTimeout(()=> {
            setIsAnimating(false)
            setShownPanelkey(null);
            setIsDisplayed(false);
            if (callback != null) {
                callback()
            }
        }, animateDuration)
    };
    useImperativeHandle(ref, () => ({

        showPanel(panelLabel, callback) {
            showPanel(panelLabel, callback);
        },
        hide(callback) {
            hide(callback);
        },
        showStartPanel(panelName) {
            showStartPanel(panelName);
        }

    }));

    return <div className={"fade-panel-set" + (isAnimating ? " uninteractive" : "")} style={{display:isDisplayed ? "flex" : "none"}}>
            <div ref={animatedRef} className={"animated"} style={{position:"absolute",bottom:0,left:0,right:0}}>



        {React.Children.map(props.children, (child) => {

            if (React.isValidElement(child)) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                const { label } = child.props;

                const childNode = React.cloneElement(child, {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    style: {
                        display: (label == shownPanelkey && isDisplayed) ? "flex" : "none",
                    }
                });
                return childNode;
            }
        })}
    </div>

    </div>;
});
