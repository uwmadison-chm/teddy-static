import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.scss'
import { MemoryRouter, Routes, Route } from "react-router";
import CalibrationScreen from "@/routes/CalibrationScreen.tsx";
import IntroScreen from "@/routes/IntroScreen.tsx";
import SpeechBubbleBlocker from "@/components/SpeechBubbleBlocker.tsx";
import RecordingNotification from "@/components/RecordingNotification.tsx";
import * as faceapi from 'face-api.js';
import { RuntimeLoader } from "@rive-app/react-webgl2";
import riveWasmUrl from "@rive-app/webgl2/rive.wasm?url";
import riveFallbackWasmUrl from "@rive-app/webgl2/rive_fallback.wasm?url";
import SessionExpiredScreen from "@/routes/SessionExpiredScreen.tsx";
import CompleteSessionScreen from "@/routes/CompleteSessionScreen.tsx";
import VideoLogScreen from "@/routes/VideoLogScreen.tsx";
import SentencesScreen from "@/routes/SentencesScreen.tsx";
import ReelsScreen from "@/routes/ReelsScreen.tsx";

// Serve Rive's WASM ourselves instead of from its default CDNs
RuntimeLoader.setWasmUrl(riveWasmUrl);
RuntimeLoader.setWasmFallbackUrl(riveFallbackWasmUrl);

faceapi.nets.tinyFaceDetector.loadFromUri('static/facemodels/').then(r => {
    console.log("Loaded Face Detector Model");
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <MemoryRouter>
          <div className={"phone-screen-wrapper"}>
              <div className={"wrapper"} id={"screen-fader"}>
                  <Routes>
                      <Route path="/" element={
                          <IntroScreen />
                      } />
                      <Route path="/calibration" element={
                          <CalibrationScreen />
                      } />
                      <Route path="/videolog" element={ // videoLog
                          <VideoLogScreen />
                      } />
                      <Route path="/sentence" element={ // sentence
                          <SentencesScreen />
                      } />
                      <Route path="/reels" element={ // reels
                          <ReelsScreen />
                      } />
                      <Route path="/end" element={
                          <CompleteSessionScreen />
                      } />
                      <Route path="/sessionexpired" element={
                          <SessionExpiredScreen />
                      } />
                  </Routes>
                  <RecordingNotification />
              </div>
          </div>
      </MemoryRouter>
      <SpeechBubbleBlocker />
  </StrictMode>,
)
