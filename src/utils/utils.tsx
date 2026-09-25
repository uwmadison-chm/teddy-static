import {type NavigateOptions, type To, useNavigate} from "react-router";

export function useAnimatedNavigate() {
    const navigate = useNavigate();

    function betterNavigate(to: To, options?: NavigateOptions) {

        const fadeOutDuration = 400
        const fadeInDuration = 200
        const rootElement = document.getElementById("screen-fader")
        rootElement.className = "wrapper uninteractive"
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

            }, fadeInDuration)
        }, fadeOutDuration + 10)

    }

    return betterNavigate;
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


export function interpolateColors(color1, color2, percent) {
    // Convert the hex colors to RGB values
    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);

    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);

    // Interpolate the RGB values
    const r = Math.round(r1 + (r2 - r1) * percent);
    const g = Math.round(g1 + (g2 - g1) * percent);
    const b = Math.round(b1 + (b2 - b1) * percent);

    // Convert the interpolated RGB values back to a hex color
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function removeItem<T>(arr: Array<T>, value: T): Array<T> {
    const index = arr.indexOf(value);
    if (index > -1) {
        arr.splice(index, 1);
    }
    return arr;
}


export function getRandomItem<T>(arr:Array<T>): T {
    return arr[Math.floor(Math.random()*arr.length)];
}
