import {FadingPanel} from "@/components/FadingPanelSet.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";

// The label WayOutPanel needs.
export const WAY_OUT_PANEL = "way-out";

// The Continue button that showWayOut() (in utils/wayOut.ts) shows, to
// nextURL. Put it in the screen's FadingPanelSet, with label={WAY_OUT_PANEL}.
export const WayOutPanel = (props: {label: string}) => {
    return (
        <FadingPanel {...props}>
            <button onClick={() => window.location.assign(CurrentSessionData.nextURL)}>
                Continue to Surveys
            </button>
        </FadingPanel>
    );
};
