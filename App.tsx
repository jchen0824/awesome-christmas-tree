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
    <h1 className="text-2xl font-serif text-yellow-500">Grand Luxury Christmas</h1>
    <p className="text-gray-400 text-sm mt-2">Assembling 45,000 lights...</p>
  </div>
);

// Procedural Tree Particles
const ChristmasTreeParticles = ({ dispersion }: { dispersion: number }) => {
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
      rnd[i3+1] = (Math.random() - 0.5) * 20;
      rnd[i3+2] = (Math.random() - 0.5) * 20;
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
      if(shaderMaterial) {
          shaderMaterial.uniforms.uTime.value = state.clock.getElapsedTime();
          shaderMaterial.uniforms.uDispersion.value = THREE.MathUtils.lerp(
              shaderMaterial.uniforms.uDispersion.value,
              dispersion,
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
const Photo = ({ url, position, rotation, index }: { url: string, position: [number, number, number], rotation: [number, number, number], index: number }) => {
  const [hovered, setHover] = useState(false);
  
  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5} position={position}>
      <group 
        rotation={rotation as any} 
        onPointerOver={() => setHover(true)} 
        onPointerOut={() => setHover(false)}
        scale={hovered ? 1.5 : 1}
      >
        {/* White Polaroid Frame */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1.2, 1.5]} />
          <meshBasicMaterial color="#fffaee" side={THREE.DoubleSide} />
        </mesh>
        
        {/* The Image with Error Boundary */}
        <ImageErrorBoundary fallback={<FallbackPhoto />}>
            <DreiImage 
                url={url} 
                position={[0, 0.1, 0]} 
                scale={[1, 1]} 
                side={THREE.DoubleSide} 
                transparent
                opacity={1}
            />
        </ImageErrorBoundary>

        {/* Glow behind */}
        {hovered && (
             <mesh position={[0, 0, -0.05]}>
                <planeGeometry args={[1.4, 1.7]} />
                <meshBasicMaterial color="#ffd700" transparent opacity={0.5} />
             </mesh>
        )}
      </group>
    </Float>
  );
};

// Floating Gifts
const Gifts = () => {
    const count = 30;
    const gifts = useMemo(() => {
        return new Array(count).fill(0).map(() => ({
            pos: [
                (Math.random() - 0.5) * 10,
                (Math.random()) * 12 - 6,
                (Math.random() - 0.5) * 10,
            ] as [number, number, number],
            color: GIFT_COLORS[Math.floor(Math.random() * GIFT_COLORS.length)],
            scale: Math.random() * 0.4 + 0.2
        }))
    }, []);

    return (
        <group>
            {gifts.map((g, i) => (
                <Float key={i} speed={1} floatIntensity={2} position={g.pos}>
                    <mesh rotation={[Math.random(), Math.random(), 0]}>
                        <boxGeometry args={[g.scale, g.scale, g.scale]} />
                        <meshStandardMaterial color={g.color} metalness={0.8} roughness={0.2} emissive={g.color} emissiveIntensity={0.5} />
                    </mesh>
                </Float>
            ))}
        </group>
    )
}

// Scene Controller
const Scene = ({ 
    photos, 
    interactionData, 
    interactionMode 
}: { 
    photos: PhotoData[], 
    interactionData: { rotation: number, dispersion: number },
    interactionMode: InteractionMode
}) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (groupRef.current) {
      if (interactionMode === InteractionMode.GESTURE) {
         groupRef.current.rotation.y += interactionData.rotation * delta;
      } else {
         groupRef.current.rotation.y += 0.1 * delta;
      }
    }
  });

  return (
    <>
      <group ref={groupRef}>
        <ChristmasTreeParticles dispersion={interactionData.dispersion} />
        
        {photos.map((photo, idx) => (
             <group key={photo.id} scale={1 + interactionData.dispersion * 0.5} position={[
                 photo.position[0] * (1 + interactionData.dispersion),
                 photo.position[1],
                 photo.position[2] * (1 + interactionData.dispersion)
             ]}>
                 <Suspense fallback={<FallbackPhoto />}>
                    <Photo {...photo} index={idx} />
                 </Suspense>
             </group>
        ))}
        
        <Gifts />
      </group>

      <Sparkles count={500} scale={20} size={4} speed={0.4} opacity={0.5} color="#ffffff" />
      <Sparkles count={200} scale={15} size={6} speed={0.2} opacity={0.6} color="#ffd700" />
      
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} color="#ffaa00" />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
    </>
  );
};


// --- Main App Component ---

const App: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(InteractionMode.MOUSE);
  const [gestureData, setGestureData] = useState({ rotation: 0, dispersion: 0, isHandDetected: false });
  const [showUI, setShowUI] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  useEffect(() => {
    const initialPhotos: PhotoData[] = [];
    // Load photos. 
    // NOTE: To use local photos, place '1.jpg' to '30.jpg' in the public/photos folder 
    // and change the url below to: `photos/${i}.jpg`
    for(let i=1; i<=TOTAL_PHOTOS; i++) {
        const angle = i * 0.8;
        const h = (i / TOTAL_PHOTOS) * 12 - 6; 
        const r = 4 + Math.random();
        initialPhotos.push({
            id: `photo-${i}`,
            // Using generic placeholders to ensure the app loads without errors if local files are missing.
            url: `https://picsum.photos/seed/${i + 2024}/400/500`, 
            position: [Math.cos(angle)*r, h, Math.sin(angle)*r],
            rotation: [0, -angle, 0] 
        });
    }
    setPhotos(initialPhotos);
  }, []);

  useEffect(() => {
      if(audioRef.current) {
          // NOTE: To use local music, place 'bgm.mp3' in public/music folder 
          // and change src to: "music/bgm.mp3"
          // Using a public domain placeholder for demonstration.
          audioRef.current.src = "https://cdn.pixabay.com/download/audio/2022/10/25/audio_1f358d6e90.mp3"; 
          audioRef.current.volume = 0.5;
          // Attempt auto-play (might be blocked by browser policy until interaction)
          audioRef.current.play().catch(e => console.log("Audio autoplay blocked (waiting for interaction):", e));
      }
  }, []);

  const handleGestureUpdate = (data: { rotation: number; dispersion: number; isHandDetected: boolean }) => {
     setGestureData(data);
  };

  const toggleMusic = () => {
      if(audioRef.current) {
          if(audioRef.current.paused) audioRef.current.play();
          else audioRef.current.pause();
      }
  }

  return (
    <div className="w-full h-full relative bg-black overflow-hidden">
      
      {/* 3D Scene */}
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 25], fov: 45 }}>
        <Suspense fallback={null}>
            <Scene 
                photos={photos} 
                interactionData={interactionMode === InteractionMode.GESTURE ? gestureData : { rotation: 0, dispersion: 0 }}
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
            autoRotate={interactionMode === InteractionMode.MOUSE && !gestureData.isHandDetected}
            autoRotateSpeed={0.5}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={Math.PI / 1.5}
        />
      </Canvas>
      
      {/* Use standard Drei Loader which detects suspense in Canvas */}
      <Loader />

      {/* UI Overlay */}
      <div className={`absolute top-0 left-0 w-full h-full pointer-events-none transition-opacity duration-500 ${showUI ? 'opacity-100' : 'opacity-0'}`}>
        {/* Header */}
        <div className="absolute top-6 left-0 w-full text-center pointer-events-auto">
            <h1 className="text-4xl md:text-6xl font-serif text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-600 drop-shadow-[0_0_10px_rgba(255,215,0,0.8)]">
                Grand Luxury Christmas
            </h1>
            <p className="text-yellow-100/80 mt-2 font-light tracking-widest text-sm uppercase">Interactive Memory Gallery</p>
        </div>

        {/* Controls Panel */}
        <div className="absolute bottom-6 left-6 flex flex-col gap-4 pointer-events-auto max-w-sm">
            
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
                        AI Hand
                    </button>
                </div>
                {interactionMode === InteractionMode.GESTURE && (
                    <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400 leading-relaxed">
                        <p><span className="text-yellow-500">✋ Open Hand:</span> Form Tree</p>
                        <p><span className="text-yellow-500">✊ Fist:</span> Cosmic Explosion</p>
                        <p><span className="text-yellow-500">↔️ Move Hand:</span> Rotate View</p>
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
      
      {!showUI && (
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
      />

    </div>
  );
};

export default App;