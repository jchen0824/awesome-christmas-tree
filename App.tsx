import React, { useState, useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  PerspectiveCamera,
  Float,
  Image as DreiImage,
  Stars,
  Sparkles,
  Text,
  Loader
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import GestureController from './components/GestureController';
import Star from './components/Star';
import LuxuryGiftBox from './components/LuxuryGiftBox';
import { PhotoData, InteractionMode } from './types';

// --- Constants ---
const PARTICLE_COUNT = 45000;
const TREE_HEIGHT = 18;
const TREE_RADIUS = 7;
const GIFT_COLORS = ['#ff0000', '#ffd700', '#ffffff', '#00ff00'];
const TOTAL_PHOTOS = 30; // Number of photos to load

// --- Error Handling ---

class ImageErrorBoundary extends React.Component<{ fallback: React.ReactNode, children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// --- Helper Components ---

const LoadingScreen = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-white z-50">
    <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-yellow-500 mb-4"></div>
    <h1 className="text-2xl font-serif text-yellow-500">Merry Christmas!</h1>
    <p className="text-gray-400 text-sm mt-2">Assembling 45,000 lights...</p>
  </div>
);

// Procedural Tree Particles
const ChristmasTreeParticles = ({ gestureRef, interactionMode }: { gestureRef: React.MutableRefObject<any>, interactionMode: InteractionMode }) => {
  const points = useRef<THREE.Points>(null);

  // Generate particles once
  const { positions, colors, randoms } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const col = new Float32Array(PARTICLE_COUNT * 3);
    const rnd = new Float32Array(PARTICLE_COUNT * 3);
    const colorObj = new THREE.Color();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      // Normalized height (0 to 1)
      const yNorm = Math.random();
      // Spiral logic
      const angle = yNorm * 50 + Math.random() * Math.PI * 2;
      const r = (1 - yNorm) * TREE_RADIUS + Math.random() * 0.5;

      const x = Math.cos(angle) * r;
      const y = yNorm * TREE_HEIGHT - TREE_HEIGHT / 2;
      const z = Math.sin(angle) * r;

      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;

      const seed = Math.random();
      if (seed > 0.95) colorObj.set('#ff0000');
      else if (seed > 0.90) colorObj.set('#00ff00');
      else if (seed > 0.8) colorObj.set('#ffffff');
      else colorObj.set('#ffd700');

      col[i3] = colorObj.r;
      col[i3 + 1] = colorObj.g;
      col[i3 + 2] = colorObj.b;

      rnd[i3] = (Math.random() - 0.5) * 20;
      rnd[i3 + 1] = (Math.random() - 0.5) * 20;
      rnd[i3 + 2] = (Math.random() - 0.5) * 20;
    }
    return { positions: pos, colors: col, randoms: rnd };
  }, []);

  // Custom Shader Material for the morphing effect
  const shaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDispersion: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uDispersion;
        uniform float uPixelRatio;
        attribute vec3 aRandom;
        varying vec3 vColor;
        
        void main() {
          vec3 pos = position;
          
          // Explosion logic
          vec3 explodedPos = position + aRandom * uDispersion * 1.5;
          
          // Add some noise/movement
          float noise = sin(uTime * 2.0 + position.y) * 0.1;
          explodedPos.x += noise * uDispersion;
          
          vec4 mvPosition = modelViewMatrix * vec4(explodedPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (40.0 * uPixelRatio) / -mvPosition.z;
          vColor = color;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float strength = distance(gl_PointCoord, vec2(0.5));
          strength = 1.0 - strength;
          strength = pow(strength, 3.0);
          gl_FragColor = vec4(vColor, strength);
        }
      `,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      transparent: true,
    });
  }, []);

  useFrame((state) => {
    if (shaderMaterial) {
      shaderMaterial.uniforms.uTime.value = state.clock.getElapsedTime();

      const targetDispersion = interactionMode === InteractionMode.GESTURE
        ? gestureRef.current.dispersion
        : 0;

      shaderMaterial.uniforms.uDispersion.value = THREE.MathUtils.lerp(
        shaderMaterial.uniforms.uDispersion.value,
        targetDispersion,
        0.1
      );
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={PARTICLE_COUNT} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-aRandom" count={PARTICLE_COUNT} array={randoms} itemSize={3} />
      </bufferGeometry>
      <primitive object={shaderMaterial} attach="material" />
    </points>
  );
};

// Fallback Photo (Gold/Grey Plane)
const FallbackPhoto = () => (
  <mesh position={[0, 0.1, 0]}>
    <planeGeometry args={[1, 1]} />
    <meshBasicMaterial color="#222" side={THREE.DoubleSide} />
  </mesh>
);

// Polaroid Photo Component
const Photo = ({ url, index, id }: { url: string, index: number, id: string }) => {
  const [hovered, setHover] = useState(false);

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5} position={[0, 0, 0]}>
      <group
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        scale={hovered ? 1.05 : 1} // Slight scale up on hover instead of separate glow mesh?
      >
        {/* Double-Sided Photo Body (Thin Box) - HITBOX */}
        <mesh
          position={[0, 0, 0]}
          name="photo-hitbox"
          userData={{ id }}
        >
          {/* Thickness 0.02 for card stock feel */}
          <boxGeometry args={[1.2, 1.5, 0.02]} />
          <meshBasicMaterial color="#fffaee" />
        </mesh>

        {/* Using ErrorBoundary for Images */}
        <ImageErrorBoundary fallback={<FallbackPhoto />}>
          {/* Front Image */}
          <DreiImage
            url={url}
            position={[0, 0.1, 0.015]} // Increased offset to 0.015 (from 0.011) to prevent Z-fighting
            scale={[1, 1]}
            transparent
            opacity={1}
          />
          {/* Back Image (Same photo, rotated) */}
          <DreiImage
            url={url}
            position={[0, 0.1, -0.015]} // Increased offset to -0.015
            rotation={[0, Math.PI, 0]} // Rotated 180 to show upright
            scale={[1, 1]}
            transparent
            opacity={1}
          />
        </ImageErrorBoundary>

        {/* Hover Glow Outline (Simple Scaled Plane behind/center?) 
            If box is used, we can just use outline or a larger plane in middle.
            Let's put a glow plane in center, large, but behind content?
            Actually, just a slightly larger plane at 0,0,0 with depthWrite=false?
        */}
        {hovered && (
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[1.4, 1.7]} />
            {/* Billboard it? Or just align with photo? Align. */}
            {/* Make it visible from both sides. */}
            <meshBasicMaterial color="#ffd700" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
      </group>
    </Float>
  );
};

const PhotoGroup = ({ photo, gestureRef, interactionMode, index, ...props }: { photo: PhotoData, gestureRef: React.MutableRefObject<any>, interactionMode: InteractionMode, index: number } & any) => {
  const groupRef = useRef<THREE.Group>(null);
  const progress = useRef(0); // 0 = Tree, 1 = Focused
  const lockedState = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null>(null);

  useFrame((state, delta) => {
    if (groupRef.current) {
      const { dispersion, focusedId } = gestureRef.current;
      const isFocused = focusedId === photo.id;

      // 1. Update Transition Progress
      const targetProgress = isFocused ? 1 : 0;
      // Use a faster lerp for responsiveness, or delta-based move
      // Simple lerp:
      progress.current = THREE.MathUtils.lerp(progress.current, targetProgress, 10 * delta);

      // Snap to target when very close to prevent oscillation
      if (Math.abs(progress.current - targetProgress) < 0.01) {
        progress.current = targetProgress;
      }

      // Optimization: if effectively 0, just sit at tree state
      if (progress.current < 0.001) {
        const activeDispersion = interactionMode === InteractionMode.GESTURE ? dispersion : 0;

        groupRef.current.position.set(
          photo.position[0] * (1 + activeDispersion),
          photo.position[1],
          photo.position[2] * (1 + activeDispersion)
        );
        groupRef.current.rotation.set(photo.rotation[0], photo.rotation[1], photo.rotation[2]);
        const s = 1 + activeDispersion * 0.5;
        groupRef.current.scale.set(s, s, s);
        lockedState.current = null; // Clear cached state
        return;
      }

      // 2. Calculate "Start" State (Tree State)
      // We must calculate this every frame because dispersion might change or to be consistent
      const activeDispersion = interactionMode === InteractionMode.GESTURE ? dispersion : 0;
      const treePos = new THREE.Vector3(
        photo.position[0] * (1 + activeDispersion),
        photo.position[1],
        photo.position[2] * (1 + activeDispersion)
      );
      const treeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...photo.rotation));
      const treeScale = new THREE.Vector3().setScalar(1 + activeDispersion * 0.5);

      // 3. Calculate "End" State (Locked World State)
      // We need to position the photo at screen center (camera view center)
      // Camera is at (0, 0, 25), looking at (0, 0, 0), so a point at (0, 0, z) where z < 25 will be centered
      // We want the photo at a comfortable viewing distance from camera (e.g., 10 units in front)
      let lockedPos: THREE.Vector3;
      let lockedQuat: THREE.Quaternion;
      const lockedScale = new THREE.Vector3(3, 3, 3); // 3x scale

      // If fully focused (progress === 1), use cached locked state to prevent shaking
      if (progress.current >= 0.99 && lockedState.current) {
        lockedPos = lockedState.current.pos;
        lockedQuat = lockedState.current.quat;
      } else {
        // Calculate locked state
        const parent = groupRef.current.parent;
        if (parent) {
          // parent.updateMatrixWorld(); // Ensure up to date
          const parentInverse = parent.matrixWorld.clone().invert();

          // Camera position in world space
          const cameraWorldPos = state.camera.position.clone();
          // Camera forward direction (negative Z in camera space, but we need world direction)
          const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.camera.quaternion);

          // Position photo 10 units in front of camera along its look direction
          const targetWorldPos = cameraWorldPos.clone().add(cameraForward.multiplyScalar(10));

          // Convert to local space of parent
          lockedPos = targetWorldPos.applyMatrix4(parentInverse);

          // Rotation: Make photo face the camera
          // Photo should have rotation that faces -camera forward (towards camera)
          const targetWorldQuat = state.camera.quaternion.clone();
          const parentWorldQuat = new THREE.Quaternion();
          parent.getWorldQuaternion(parentWorldQuat);
          lockedQuat = parentWorldQuat.invert().multiply(targetWorldQuat);

          // Cache the locked state when we're nearly there
          if (progress.current >= 0.99) {
            lockedState.current = {
              pos: lockedPos.clone(),
              quat: lockedQuat.clone(),
              scale: lockedScale.clone()
            };
          }
        } else {
          // Fallback if no parent (shouldn't happen)
          lockedPos = treePos;
          lockedQuat = treeQuat;
        }
      }

      // 4. Interpolate
      // Using smoothstep for factor? or just linear `progress` since we lerped `progress` itself.
      // `progress` is already smoothed by lerp.

      groupRef.current.position.lerpVectors(treePos, lockedPos, progress.current);
      groupRef.current.quaternion.slerpQuaternions(treeQuat, lockedQuat, progress.current);
      groupRef.current.scale.lerpVectors(treeScale, lockedScale, progress.current);
    }
  });

  return (
    <group ref={groupRef} {...props}>
      <Suspense fallback={<FallbackPhoto />}>
        {/* We moved rotation logic to the group itself, so we don't pass initial rotation here as prop if we override it.
            Wait, the <group> had `rotation={photo.rotation}` prop initially. 
            If we control quaternion manually in useFrame, the prop is ignored after mount.
            But cleaner to remove it from JSX to avoid confusion.
            Also, Photo component has generic implementation.
        */}
        <Photo url={photo.url} index={index} id={photo.id} />
      </Suspense>
    </group>
  );
};

// Floating Gifts
// Floating Gifts - Abundance & Luxury
const Gifts = () => {
  const count = 60; // Increased count for abundance
  const gifts = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      // Create a "pile" effect: more concentrated near the center, but leaving space for the tree trunk
      const angle = Math.random() * Math.PI * 2;
      const minRadius = 2;
      const maxRadius = 12;
      // Power of 2 to bias towards center (inner ring) or uniform? 
      // Let's use uniform r but bias density. 
      const r = minRadius + Math.random() * (maxRadius - minRadius);

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = -TREE_HEIGHT / 2 + Math.random() * 2; // Pile up at the base

      return {
        pos: [x, y, z] as [number, number, number],
        scale: Math.random() * 0.5 + 0.3,
        rotation: [0, Math.random() * Math.PI, 0] as [number, number, number],
        color: Math.random() > 0.5 ? 'black' : 'white' as 'black' | 'white'
      };
    });
  }, []);

  return (
    <group>
      {gifts.map((g, i) => (
        <Float key={i} speed={0.5} rotationIntensity={0.2} floatIntensity={0.5} position={g.pos}>
          <LuxuryGiftBox
            position={[0, 0, 0]}
            rotation={g.rotation}
            scale={g.scale}
            color={g.color}
          />
        </Float>
      ))}
    </group>
  )
}

// Scene Controller
// Scene Controller
const Scene = ({
  photos,
  gestureRef,
  interactionMode
}: {
  photos: PhotoData[],
  gestureRef: React.MutableRefObject<{
    rotation: number,
    dispersion: number,
    isHandDetected: boolean,
    cursor?: { x: number, y: number },
    isPinching?: boolean,
    focusedId?: string | null // We treat this as a readable/writable field on the ref for communication
  }>,
  interactionMode: InteractionMode
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useFrame((state, delta) => {
    // 1. Scene Rotation Logic
    if (groupRef.current) {
      let speed = 0.1;
      if (interactionMode === InteractionMode.GESTURE) {
        speed = gestureRef.current.rotation;
      }

      // If focused, slow down significantly to avoid dizziness
      if (gestureRef.current.focusedId) {
        speed *= 0.05;
      }

      groupRef.current.rotation.y += speed * delta;
    }

    // 2. Raycasting Logic for Focus Mode
    if (interactionMode === InteractionMode.GESTURE && gestureRef.current.isHandDetected && gestureRef.current.cursor) {
      const { cursor, isPinching } = gestureRef.current;

      // Update raycaster
      raycaster.setFromCamera(new THREE.Vector2(cursor.x, cursor.y), camera);

      // Raycast against photos
      // We look for objects with name "photo-hitbox"
      const intersects = raycaster.intersectObjects(scene.children, true);
      const hit = intersects.find(i => i.object.name === "photo-hitbox");

      if (hit && isPinching) {
        // If pinching a photo, focus it
        gestureRef.current.focusedId = hit.object.userData.id;
      } else if (!isPinching) {
        // Release focus if not pinching
        gestureRef.current.focusedId = null;
      }
    }
    // Removed the 'else' block that forced null focus in non-gesture mode
    // This allows mouse clicks to set and keep focus.
  });

  return (
    <>
      <group ref={groupRef}>
        <ChristmasTreeParticles gestureRef={gestureRef} interactionMode={interactionMode} />

        <Star position={[0, TREE_HEIGHT / 2, 0]} />

        {photos.map((photo, idx) => (
          <PhotoGroup
            key={photo.id}
            photo={photo}
            gestureRef={gestureRef}
            interactionMode={interactionMode}
            index={idx}
            onClick={(e: any) => {
              if (interactionMode === InteractionMode.MOUSE) {
                e.stopPropagation();
                // Toggle Focus
                if (gestureRef.current.focusedId === photo.id) {
                  gestureRef.current.focusedId = null;
                } else {
                  gestureRef.current.focusedId = photo.id;
                }
              }
            }}
            onPointerOver={() => { if (interactionMode === InteractionMode.MOUSE) document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { if (interactionMode === InteractionMode.MOUSE) document.body.style.cursor = 'auto'; }}
          />
        ))}

        <Gifts />
      </group>

      <Sparkles count={500} scale={20} size={4} speed={0.4} opacity={0.5} color="#ffffff" />
      <Sparkles count={200} scale={15} size={6} speed={0.2} opacity={0.6} color="#ffd700" />

      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} color="#ffaa00" />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

      <Cursor gestureRef={gestureRef} interactionMode={interactionMode} />
    </>
  );
};

// Visual Cursor for Gesture Mode
const Cursor = ({ gestureRef, interactionMode }: { gestureRef: React.MutableRefObject<any>, interactionMode: InteractionMode }) => {
  const cursorRef = useRef<THREE.Mesh>(null);
  const { viewport } = useThree();

  useFrame(() => {
    if (cursorRef.current && interactionMode === InteractionMode.GESTURE && gestureRef.current.cursor && gestureRef.current.isHandDetected) {
      const { x, y } = gestureRef.current.cursor;
      // Cursor x,y are NDC [-1, 1].
      // Map to viewport coordinates.
      // Viewport width/height at z=0 (or whatever distance we want the cursor).
      // We want it to be "on screen".
      // Let's put it at z = 10 (arbitrary, ahead of camera which is 25).
      // Actually, standard method is to put it attached to camera or converting screen to world.
      // Easiest: use Drei <Html> or just put a mesh at z=20 (camera is 25).

      // Calculate world width/height at distance 5 from camera (25-20=5).
      // fov=45.
      const dist = 5;
      const vH = 2 * Math.tan((45 * Math.PI) / 180 / 2) * dist;
      const vW = vH * viewport.aspect;

      const wx = (x * vW) / 2;
      const wy = (y * vH) / 2;

      cursorRef.current.position.set(wx, wy, 20);
      cursorRef.current.visible = true;

      // Color change on Pinch
      (cursorRef.current.material as THREE.MeshBasicMaterial).color.set(
        gestureRef.current.isPinching ? '#00ff00' : '#ff0000'
      );
    } else if (cursorRef.current) {
      cursorRef.current.visible = false;
    }
  });

  return (
    <mesh ref={cursorRef} visible={false}>
      <ringGeometry args={[0.05, 0.08, 32]} />
      <meshBasicMaterial color="#ff0000" transparent opacity={0.8} depthTest={false} />
    </mesh>
  );
};


// --- Main App Component ---

const WelcomeScreen = ({ onStart }: { onStart: () => void }) => (
  <div
    onClick={onStart}
    className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 z-[100] cursor-pointer"
  >
    <div className="text-center animate-pulse">
      <h1 className="text-4xl md:text-6xl font-serif text-yellow-500 mb-6 drop-shadow-[0_0_15px_rgba(255,215,0,0.5)]">
        Merry Christmas 🎄
      </h1>
      <div className="inline-block border border-yellow-500/50 rounded-full px-8 py-3 text-yellow-200 hover:bg-yellow-500/20 transition-all duration-500">
        Click to Enter
      </div>
      <p className="text-gray-500 text-xs mt-8 uppercase tracking-widest">Turn on sound for best experience</p>
    </div>
  </div>
);

const App: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(InteractionMode.MOUSE);
  const [debugMode, setDebugMode] = useState(false);
  // Replaced state with Ref for high-frequency gesture updates
  const gestureRef = useRef<{
    rotation: number;
    dispersion: number;
    isHandDetected: boolean;
    cursor?: { x: number, y: number };
    isPinching?: boolean;
    focusedId?: string | null;
  }>({ rotation: 0, dispersion: 0, isHandDetected: false, focusedId: null });
  // Keep track of hand detection state for UI toggles only
  const [isHandDetected, setIsHandDetected] = useState(false);

  const [showUI, setShowUI] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const initialPhotos: PhotoData[] = [];
    // Load photos. 
    // NOTE: To use local photos, place '1.jpg' to '30.jpg' in the public/photos folder 
    // and change the url below to: `photos/${i}.jpg`
    for (let i = 1; i <= TOTAL_PHOTOS; i++) {
      const angle = i * 0.8;
      const h = (i / TOTAL_PHOTOS) * 12 - 6;
      const r = 4 + Math.random();
      initialPhotos.push({
        id: `photo-${i}`,
        // Using generic placeholders to ensure the app loads without errors if local files are missing.
        url: `https://picsum.photos/seed/${i + 2024}/400/500`,
        position: [Math.cos(angle) * r, h, Math.sin(angle) * r],
        rotation: [0, -angle, 0]
      });
    }
    setPhotos(initialPhotos);
  }, []);

  const handleStart = () => {
    setHasStarted(true);
    if (audioRef.current) {
      audioRef.current.src = "music/bgm.mp3";
      audioRef.current.volume = 0.5;
      audioRef.current.play().catch(e => console.error("Audio playback error:", e));
    }
  };

  const handleGestureUpdate = (data: {
    rotation: number;
    dispersion: number;
    isHandDetected: boolean;
    cursor?: { x: number, y: number };
    isPinching?: boolean;
  }) => {
    // Update ref immediately
    // Preserve existing focusId if not managed by onUpdate (actually onUpdate from gesture controller doesn't know about focusId)
    // We merge the new data with the existing ref data, ensuring we don't overwrite focusedId with undefined if it's not passed
    // But gestureController passes a whole new object for rotation/dispersion.
    // We should copy focusedId from current ref if we want to persist it, BUT Scene updates focusedId.
    // Scene reads/writes focusedId. gestureRef is shared.
    // If we overwrite gestureRef.current here, we might lose focusedId if we just do `gestureRef.current = data`.
    // Correct approach: Object.assign or spread, but be careful.
    // Scene writes focusedId to the SAME ref object interactively? 
    // If we replace the object reference, Scene's ref.current changes.
    // If handleGestureUpdate runs, it sets `gestureRef.current = data`. `data` does NOT contain focusedId.
    // So focusedId becomes undefined.
    // Fix:
    gestureRef.current = {
      ...gestureRef.current,
      ...data
    };

    // Only trigger re-render if hand presence changes
    if (data.isHandDetected !== isHandDetected) {
      setIsHandDetected(data.isHandDetected);
    }
  };

  const toggleMusic = () => {
    if (audioRef.current) {
      if (audioRef.current.paused) audioRef.current.play();
      else audioRef.current.pause();
    }
  }

  return (
    <div className="w-full h-full relative bg-black overflow-hidden">
      {!hasStarted && <WelcomeScreen onStart={handleStart} />}

      {/* 3D Scene */}
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 25], fov: 45 }} onPointerMissed={() => { gestureRef.current.focusedId = null; }}>
        <Suspense fallback={null}>
          <Scene
            photos={photos}
            gestureRef={gestureRef}
            interactionMode={interactionMode}
          />
          <EffectComposer>
            <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.9} height={300} intensity={1.5} />
            <Vignette eskil={false} offset={0.1} darkness={1.1} />
          </EffectComposer>
        </Suspense>
        <OrbitControls
          enableZoom={true}
          enablePan={false}
          autoRotate={interactionMode === InteractionMode.MOUSE && !isHandDetected}
          autoRotateSpeed={0.5}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 1.5}
        />
      </Canvas>

      {/* Use standard Drei Loader which detects suspense in Canvas */}
      <Loader />

      {/* UI Overlay */}
      <div className={`absolute top-0 left-0 w-full h-full pointer-events-none transition-opacity duration-500 ${showUI && hasStarted ? 'opacity-100' : 'opacity-0'}`}>
        {/* Header */}
        <div className="absolute top-6 left-0 w-full text-center pointer-events-auto">
          <h1 className="text-4xl md:text-6xl font-serif text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-600 drop-shadow-[0_0_10px_rgba(255,215,0,0.8)]">
            Merry Christmas 🎄
          </h1>
          <p className="text-yellow-100/80 mt-2 font-light tracking-widest text-sm uppercase">Interactive Memory Gallery</p>
        </div>

        {/* Controls Panel - Top Left */}
        <div className="absolute top-6 left-6 flex flex-col gap-4 pointer-events-auto max-w-sm">

          {/* Mode Switcher & Music */}
          <div className="bg-black/60 backdrop-blur-md p-4 rounded-xl border border-yellow-500/30 text-white shadow-lg">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-yellow-400 font-bold uppercase text-xs tracking-wider">Control Center</h3>
              <button
                onClick={toggleMusic}
                className="text-xs bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-200 px-2 py-1 rounded transition-colors"
              >
                🎵 Toggle Music
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setInteractionMode(InteractionMode.MOUSE)}
                className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all border border-transparent ${interactionMode === InteractionMode.MOUSE ? 'bg-yellow-500 text-black font-bold shadow-[0_0_10px_rgba(255,215,0,0.4)]' : 'bg-gray-800 hover:bg-gray-700 hover:border-gray-600'}`}
              >
                Mouse
              </button>
              <button
                onClick={() => setInteractionMode(InteractionMode.GESTURE)}
                className={`flex-1 px-4 py-2 rounded-lg text-sm transition-all border border-transparent ${interactionMode === InteractionMode.GESTURE ? 'bg-yellow-500 text-black font-bold shadow-[0_0_10px_rgba(255,215,0,0.4)]' : 'bg-gray-800 hover:bg-gray-700 hover:border-gray-600'}`}
              >
                Gesture
              </button>
            </div>
            {interactionMode === InteractionMode.GESTURE && (
              <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400 leading-relaxed">
                <p><span className="text-yellow-500">✋ Open Hand:</span> Cosmic Explosion</p>
                <p><span className="text-yellow-500">✊ Fist:</span> Form Tree</p>
                <p><span className="text-yellow-500">↔️ Move Hand:</span> Rotate View</p>
                <p><span className="text-yellow-500">👆 Point (Open):</span> Select Photo</p>
                <button
                  onClick={() => setDebugMode(!debugMode)}
                  className="mt-2 text-xs bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-200 px-2 py-1 rounded transition-colors w-full"
                >
                  {debugMode ? '🎥 Hide Camera' : '🎥 Show Camera'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Hide UI Toggle */}
        <button
          onClick={() => setShowUI(false)}
          className="absolute top-6 right-6 pointer-events-auto text-white/50 hover:text-white transition-colors"
        >
          Hide UI
        </button>
      </div>

      {!showUI && hasStarted && (
        <button
          onClick={() => setShowUI(true)}
          className="absolute top-6 right-6 z-50 pointer-events-auto text-white/50 hover:text-white bg-black/50 px-3 py-1 rounded backdrop-blur-sm"
        >
          Show UI
        </button>
      )}

      {/* Hidden Audio Element */}
      <audio ref={audioRef} loop crossOrigin="anonymous" />

      {/* Gesture Handler (Invisible logical component, renders preview in corner) */}
      <GestureController
        enabled={interactionMode === InteractionMode.GESTURE}
        onUpdate={handleGestureUpdate}
        debugMode={debugMode}
      />

    </div>
  );
};

export default App;