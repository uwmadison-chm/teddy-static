import {type NavigateOptions, type To, useNavigate} from "react-router";

export function useAnimatedNavigate() {
    const navigate = useNavigate();

    function betterNavigate(to: To, options?: NavigateOptions) {

        const fadeOutDuration = 400
        const fadeInDuration = 200
        const rootElement = document.getElementById("screen-fader")
        rootElement.className = "wrapper uninteractive"
        // Keys too: a second Enter on the button that started this would navigate again
        rootElement.inert = true
        rootElement.animate([{opacity:1}, {opacity:0}],
            {
                duration: fadeOutDuration,
                easing: "ease-in",
                fill: "both",
            })
        setTimeout(()=> {

            navigate(to, options);

            rootElement.animate([{opacity:0}, {opacity:1}],
                {
                    duration: fadeOutDuration,
                    easing: "ease-in",
                    fill: "both",
                })
            setTimeout(()=> {
                rootElement.className = "wrapper"
                rootElement.inert = false

            }, fadeInDuration)
        }, fadeOutDuration + 10)

    }

    return betterNavigate;
}

// Whether the participant has asked their device for less motion.
export function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export const saveBlob = (function () {
    const a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";
    return function (blob, fileName) {
        const url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
    };
}());

