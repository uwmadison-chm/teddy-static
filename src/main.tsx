import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.scss'
import { MemoryRouter, Routes, Route } from "react-router";
import CalibrationScreen from "@/routes/CalibrationScreen.tsx";
import IntroScreen from "@/routes/IntroScreen.tsx";
import SpeechBubbleBlocker from "@/components/SpeechBubbleBlocker.tsx";
import Announcer from "@/components/Announcer.tsx";
import RecordingNotification from "@/components/RecordingNotification.tsx";
import * as faceapi from 'face-api.js';
import { RuntimeLoader } from "@rive-app/react-canvas-lite";
import riveWasmUrl from "@rive-app/canvas-lite/rive.wasm?url";
import riveFallbackWasmUrl from "@rive-app/canvas-lite/rive_fallback.wasm?url";
import faceModelManifest from "@/assets/facemodels/tiny_face_detector_model-weights_manifest.json";
import faceModelWeightsUrl from "@/assets/facemodels/tiny_face_detector_model-shard1.shard?url";
import SessionExpiredScreen from "@/routes/SessionExpiredScreen.tsx";
import LinkProblemScreen from "@/routes/LinkProblemScreen.tsx";
import CameraHelpScreen from "@/routes/CameraHelpScreen.tsx";
import CompleteSessionScreen from "@/routes/CompleteSessionScreen.tsx";
import VideoLogScreen from "@/routes/VideoLogScreen.tsx";
import SentencesScreen from "@/routes/SentencesScreen.tsx";
import ReelsScreen from "@/routes/ReelsScreen.tsx";
import {Config} from "@/data/config.ts";

// Serve Rive's WASM ourselves instead of from its default CDNs
RuntimeLoader.setWasmUrl(riveWasmUrl);
RuntimeLoader.setWasmFallbackUrl(riveFallbackWasmUrl);

// Loaded from the bundle's hashed URLs instead of with loadFromUri, which finds
// the weights file by its unhashed name in the manifest.
fetch(faceModelWeightsUrl)
    .then(response => response.arrayBuffer())
    .then(weights => {
        faceapi.nets.tinyFaceDetector.loadFromWeightMap(
            faceapi.tf.io.decodeWeights(weights, faceModelManifest[0].weights as faceapi.tf.io.WeightsManifestEntry[]));
        console.log("Loaded Face Detector Model");
    })

createRoot(document.getElementById('root')!).render(
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
                      <Route path="/camerahelp" element={
                          <CameraHelpScreen />
                      } />
                      <Route path="/linkproblem" element={
                          <LinkProblemScreen />
                      } />
                  </Routes>
                  <RecordingNotification />
                  {Config.debug && <div className={"debug-banner"}>Debug mode: nothing is uploaded</div>}
              </div>
          </main>
      </MemoryRouter>
      <SpeechBubbleBlocker />
      <Announcer />
  </StrictMode>,
)
