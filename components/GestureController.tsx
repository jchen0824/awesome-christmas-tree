import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';

interface GestureControllerProps {
  onUpdate: (data: {
    rotation: number;
    dispersion: number;
    isHandDetected: boolean;
    cursor?: { x: number, y: number };
    isPinching?: boolean;
  }) => void;
  enabled: boolean;
  debugMode?: boolean;
}

const GestureController: React.FC<GestureControllerProps> = ({ onUpdate, enabled, debugMode = false }) => {
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
    let lastVideoTime = -1;
    let isRunning = true; // Flag to prevent multiple concurrent loops

    const predictWebcam = () => {
      if (!isRunning) return; // Stop if cleanup has been called

      // Ensure we have everything
      if (!handLandmarkerRef.current || !video || !canvasRef.current) {
        if (isRunning) {
          requestRef.current = requestAnimationFrame(predictWebcam);
        }
        return;
      }

      try {
        // CRITICAL FIX: MediaPipe crashes if we pass a 0x0 video frame.
        // We must ensure the video has valid dimensions and is ready.
        if (video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1) {
          if (isRunning) {
            requestRef.current = requestAnimationFrame(predictWebcam);
          }
          return;
        }

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        // Match canvas size to video if changed
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        let nowInMs = Date.now();
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;

          // Use handLandmarkerRef.current logic
          const result = handLandmarkerRef.current.detectForVideo(video, nowInMs);

          // Draw landmarks for debug/feedback
          if (ctx) {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Note: We do NOT mirror the context here because the canvas element 
            // itself is already mirrored via CSS (scale-x-[-1])

            if (result.landmarks) {
              const drawingUtils = new DrawingUtils(ctx); // Instantiate DrawingUtils here
              for (const landmarks of result.landmarks) {
                drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
                  color: "#00FF00",
                  lineWidth: 5
                });
                drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 2 });
              }
            }
            ctx.restore();
          }

          if (result.landmarks && result.landmarks.length > 0) {
            const landmarks = result.landmarks[0];
            const wrist = landmarks[0];
            const indexTip = landmarks[8];
            const thumbTip = landmarks[4];
            const middleTip = landmarks[12];

            // 1. Calculate Rotation & Dispersion (Legacy Logic)
            const rotationValue = (wrist.x - 0.5) * 5;
            // Dispersion: Middle finger tip to wrist distance
            const dist = Math.sqrt(
              Math.pow(middleTip.x - wrist.x, 2) +
              Math.pow(middleTip.y - wrist.y, 2)
            );
            // Map 0.15-0.35 to 0-1
            // INVERTED: Open hand (large dist) = 1 (dispersed), Fist (small dist) = 0 (assembled)
            let dispersionValue = Math.min(Math.max((dist - 0.15) / (0.35 - 0.15), 0), 1);

            // 2. Calculate Cursor & Pinch with Aspect Ratio Correction

            // Aspect Ratio Correction for Cursor
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            const videoRatio = vw / vh;
            const windowRatio = window.innerWidth / window.innerHeight;

            let scaleX = 1;
            let scaleY = 1;

            // 'Cover' Mode Logic
            if (windowRatio > videoRatio) {
              // Window is wider
              scaleY = windowRatio / videoRatio;
            } else {
              // Window is taller
              scaleX = videoRatio / windowRatio;
            }

            // Convert to NDC coordinates
            // NOTE: We do NOT mirror X here because the video element itself is already mirrored with CSS
            let x = (indexTip.x * 2 - 1);
            let y = -(indexTip.y * 2 - 1); // Invert Y for Three.js coordinate system

            // Apply Aspect correction
            x *= scaleX;
            y *= scaleY;

            // Open Hand Detection for Photo Selection
            // When hand is OPEN (large dist between middle finger and wrist), trigger selection
            // This is more natural than pinch when using fist to assemble the tree
            // Lowered threshold to 0.25 (from 0.3) to make selection easier and more forgiving
            const isOpenHandSelect = dist > 0.3;

            onUpdate({
              rotation: rotationValue,
              dispersion: dispersionValue,
              isHandDetected: true,
              cursor: { x, y },
              isPinching: isOpenHandSelect // Renamed from isPinching but keeps same interface
            });

          } else {
            // Hand lost
            onUpdate({
              rotation: 0,
              dispersion: 0,
              isHandDetected: false,
              cursor: { x: 0, y: 0 }, // Reset or keep last? Resetting is safer to stop accidental clicks
              isPinching: false
            });
          }
        }
      } catch (e) {
        console.warn("Detection error, skipping frame:", e);
      }

      if (isRunning) {
        requestRef.current = requestAnimationFrame(predictWebcam); // Schedule next frame
      }
    };

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        // Start prediction loop once video is ready
        predictWebcam();
      } catch (err) {
        console.error("Camera access denied:", err);
      }
    };

    startCamera();

    return () => {
      isRunning = false; // Signal the loop to stop
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = 0;
      }
      if (video.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [enabled, isLoaded]); // Removed onUpdate from dependencies to prevent re-running

  if (!enabled) return null;

  // Always render video/canvas for gesture tracking to work
  // Just hide the container visually when debugMode is false
  return (
    <div className={`fixed bottom-4 right-4 w-48 h-36 border-2 border-yellow-500 rounded-lg overflow-hidden bg-black z-50 shadow-[0_0_15px_rgba(255,215,0,0.5)] ${debugMode ? '' : 'invisible pointer-events-none'}`}>
      {!isLoaded && debugMode && <div className="absolute inset-0 flex items-center justify-center text-white text-xs">Loading AI...</div>}
      <video ref={videoRef} className="absolute w-full h-full object-cover transform scale-x-[-1]" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="absolute w-full h-full object-cover transform scale-x-[-1]" />
    </div>
  );
};

export default GestureController;