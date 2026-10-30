import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { MemoryRouter, Routes, Route } from "react-router";
import CalibrationScreen from "@/routes/CalibrationScreen.tsx";
import IntroScreen from "@/routes/IntroScreen.tsx";
import SpeechBubbleBlocker from "@/components/SpeechBubbleBlocker.tsx";
import Announcer from "@/components/Announcer.tsx";
import RecordingNotification from "@/components/RecordingNotification.tsx";
import { RuntimeLoader } from "@rive-app/react-canvas-lite";
import riveWasmUrl from "@rive-app/canvas-lite/rive.wasm?url";
import riveFallbackWasmUrl from "@rive-app/canvas-lite/rive_fallback.wasm?url";
import SessionExpiredScreen from "@/routes/SessionExpiredScreen.tsx";
import LinkProblemScreen from "@/routes/LinkProblemScreen.tsx";
import CameraHelpScreen from "@/routes/CameraHelpScreen.tsx";
import CompleteSessionScreen from "@/routes/CompleteSessionScreen.tsx";
import VideoLogScreen from "@/routes/VideoLogScreen.tsx";
import SentencesScreen from "@/routes/SentencesScreen.tsx";
import ReelsScreen from "@/routes/ReelsScreen.tsx";
import QuestionnaireScreen from "@/routes/QuestionnaireScreen.tsx";
import {Config} from "@/data/config.ts";
import {loadFaceApi} from "@/utils/faceApi.ts";
import LinkBuilderScreen from "@/routes/LinkBuilderScreen.tsx";
import {CurrentSessionData, errorFields} from "@/data/sessionData.tsx";
import {showPlainWayOut} from "@/utils/wayOut.ts";
import {preloadReels} from "@/data/reelPreload.ts";
import {preloadChime} from "@/data/chimePreload.ts";

// In debug mode, ?links opens the link builder instead of a session.
const showLinkBuilder = Config.debug && new URLSearchParams(window.location.search).has("links");

// Serve Rive's WASM ourselves instead of from its default CDNs
RuntimeLoader.setWasmUrl(riveWasmUrl);
RuntimeLoader.setWasmFallbackUrl(riveFallbackWasmUrl);

// A screen that fails while React draws it takes the whole page down, so put up
// a plain page with a way out instead of leaving the participant a blank one.
// In the link builder, the console is enough.
function onUncaughtError(error: unknown) {
    console.error("The page failed:", error);
    if (showLinkBuilder) {
        return;
    }
    CurrentSessionData.logEvent("uncaught_exception", errorFields(error), "error");
    showPlainWayOut();
}

createRoot(document.getElementById('root')!, {onUncaughtError}).render(showLinkBuilder ? <StrictMode><LinkBuilderScreen /></StrictMode> :
  <StrictMode>
      <MemoryRouter>
          <main className={"phone-screen-wrapper"}>
              <div className={"wrapper"} id={"screen-fader"}>
                  <Routes>
                      <Route path="/" element={
                          <IntroScreen />
                      } />
                      <Route path="/calibration" element={
                          <CalibrationScreen />
                      } />
                      <Route path="/videologs" element={ // videologs
                          <VideoLogScreen />
                      } />
                      <Route path="/sentences" element={ // sentences
                          <SentencesScreen />
                      } />
                      <Route path="/reels" element={ // reels
                          <ReelsScreen />
                      } />
                      <Route path="/questions" element={ // questions
                          <QuestionnaireScreen />
                      } />
                      <Route path="/end" element={
                          <CompleteSessionScreen />
                      } />
                      <Route path="/sessionexpired" element={
                          <SessionExpiredScreen />
                      } />
                      <Route path="/camerahelp" element={
                          <CameraHelpScreen />
                      } />
                      <Route path="/linkproblem" element={
                          <LinkProblemScreen />
                      } />
                  </Routes>
                  <RecordingNotification />
                  {Config.debug && <div className={"debug-banner"}>
                  Debug mode: nothing is uploaded · <a href={"?links"} target={"_blank"} rel={"noreferrer"}>Link builder</a>
              </div>}
              </div>
          </main>
      </MemoryRouter>
      <SpeechBubbleBlocker />
      <Announcer />
  </StrictMode>,
)

// Start loading the face detector now, in a worker, so it's ready
// and warmed up by the calibration screen
if (!showLinkBuilder) loadFaceApi().catch(error => console.error("Couldn't load face detector", error));
// Start downloading the session's reels once the page itself has loaded, so
// they don't hold up Teddy or the face detector
if (!showLinkBuilder) window.addEventListener("load", preloadReels, {once: true});
if (!showLinkBuilder) window.addEventListener("load", preloadChime, {once: true});
