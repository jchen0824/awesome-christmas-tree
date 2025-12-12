import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';

interface GestureControllerProps {
  onUpdate: (data: { rotation: number; dispersion: number; isHandDetected: boolean }) => void;
  enabled: boolean;
}

const GestureController: React.FC<GestureControllerProps> = ({ onUpdate, enabled }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const init = async () => {
      try {
        console.log("Initializing MediaPipe HandLandmarker...");
        // Use local WASM and Model files for performance
        const wasmUrl = "wasm";
        const vision = await FilesetResolver.forVisionTasks(wasmUrl);

        if (!vision) {
          throw new Error("Failed to initialize FilesetResolver");
        }

        handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "models/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        console.log("MediaPipe initialized with local assets");

        setIsLoaded(true);
      } catch (error: any) {
        console.error("Failed to load MediaPipe:", error.message || JSON.stringify(error));
      }
    };

    if (enabled && !handLandmarkerRef.current) {
      init();
    }

    return () => {
      // Cleanup logic if needed
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isLoaded || !videoRef.current) return;

    const video = videoRef.current;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
      } catch (err) {
        console.error("Camera access denied:", err);
      }
    };

    startCamera();

    let lastVideoTime = -1;

    const predictWebcam = () => {
      if (!handLandmarkerRef.current || !video || !canvasRef.current) return;

      // CRITICAL FIX: MediaPipe crashes if we pass a 0x0 video frame.
      // We must ensure the video has valid dimensions and is ready.
      if (video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1) {
        requestRef.current = requestAnimationFrame(predictWebcam);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      // Match canvas size to video if changed
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const startTimeMs = performance.now();

      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
          const results = handLandmarkerRef.current.detectForVideo(video, startTimeMs);

          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }

          if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];

            // Draw landmarks
            if (ctx) {
              const drawingUtils = new DrawingUtils(ctx);
              drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
              drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
            }

            // 1. Calculate Rotation based on Hand X position (normalized 0-1)
            const wrist = landmarks[0];
            // Mirror logic: moving hand right (screen left) should rotate one way
            const rotationValue = (wrist.x - 0.5) * 5; // -2.5 to 2.5 speed

            // 2. Calculate Dispersion based on "Fist" vs "Open Hand"
            // We check distance between wrist (0) and middle finger tip (12)
            const middleTip = landmarks[12];
            const dist = Math.sqrt(
              Math.pow(middleTip.x - wrist.x, 2) +
              Math.pow(middleTip.y - wrist.y, 2)
            );

            // Heuristic: Distance > 0.3 is open hand (Tree), < 0.15 is fist (Explode/Galaxy)
            // Mapping: 0.1 (fist) -> 1 (dispersion), 0.4 (open) -> 0 (dispersion)
            let dispersionValue = 1 - Math.min(Math.max((dist - 0.15) / (0.35 - 0.15), 0), 1);

            onUpdate({
              rotation: rotationValue,
              dispersion: dispersionValue,
              isHandDetected: true
            });

          } else {
            // When hand is lost, we stop rotation/dispersion or let it decay?
            // For now, let's keep it steady or reset
            onUpdate({ rotation: 0.1, dispersion: 0, isHandDetected: false }); // Idle spin
          }
        } catch (e) {
          console.warn("Detection error, skipping frame:", e);
        }
      }

      requestRef.current = requestAnimationFrame(predictWebcam);
    };

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      // We don't stop the tracks here to avoid re-asking permission or black screen flicker
      // if the user toggles modes quickly. But for cleanup we should.
      // For this app, we can keep it running if enabled is true.
      if (!enabled && video.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [enabled, isLoaded, onUpdate]);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 w-48 h-36 border-2 border-yellow-500 rounded-lg overflow-hidden bg-black z-50 shadow-[0_0_15px_rgba(255,215,0,0.5)]">
      {!isLoaded && <div className="absolute inset-0 flex items-center justify-center text-white text-xs">Loading AI...</div>}
      <video ref={videoRef} className="absolute w-full h-full object-cover transform scale-x-[-1]" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="absolute w-full h-full object-cover transform scale-x-[-1]" />
    </div>
  );
};

export default GestureController;