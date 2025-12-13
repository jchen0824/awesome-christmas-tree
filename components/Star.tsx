import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles, Float } from '@react-three/drei';
import * as THREE from 'three';

const Star = ({ position }: { position: [number, number, number] }) => {
    const meshRef = useRef<THREE.Group>(null);

    // Custom Faceted Star Geometry -> Switched to ExtrudeGeometry for Smoother Beveled Edges
    const { geometry, centerOffset } = useMemo(() => {
        const shape = new THREE.Shape();
        const points = 5;
        const rOuter = 2.0;
        const rInner = 0.9; // Slightly fatter for smoother look

        // Draw the 2D Star
        for (let i = 0; i < points * 2; i++) {
            // Use + PI/2 to start at Top (Point UP)
            const angle = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
            const r = i % 2 === 0 ? rOuter : rInner;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r; // In 2D shape, Y is up, X is right.
            if (i === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
        }
        shape.closePath();

        // Extrude Settings for "Puffy/Beveled" look
        const extrudeSettings = {
            depth: 0.4,           // Base thickness
            bevelEnabled: true,
            bevelThickness: 0.6,  // Height of the bevel (z-axis) - creates the "pyramid" feel
            bevelSize: 0.4,       // Inset of the bevel (xy-axis) - how much it slopes in
            bevelSegments: 8      // ROUNDS the edges! High number = smooth.
        };

        const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geo.center(); // Important to center the geometry
        return { geometry: geo, centerOffset: 0 };
    }, []);

    useFrame((state) => {
        if (meshRef.current) {
            // Slow majestic rotation
            meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.2;
            meshRef.current.rotation.z = Math.sin(state.clock.getElapsedTime() * 0.5) * 0.05;
        }
    });

    return (
        <group position={position} ref={meshRef}>
            <Float speed={1} rotationIntensity={0.2} floatIntensity={0.2}>
                {/* Rotate geometry to face camera correctly? Extrude is in XY plane. Application is Z-up? No, Y-up. Star is XY (facing Z). Correct. */}
                <mesh geometry={geometry}>
                    <meshPhysicalMaterial
                        color="#ffb700"
                        emissive="#ffaa00"
                        emissiveIntensity={2} // Reduced slightly due to larger surface area reflecting
                        metalness={1} // Full gold
                        roughness={0.15} // Slightly softer
                        clearcoat={1}
                        clearcoatRoughness={0.1}
                    // flatShading={false} // Smooth shading for the bevels
                    />
                </mesh>

                {/* The Light */}
                <pointLight intensity={2} distance={15} color="#ffaa00" decay={2} />

                {/* Minimal Sparkles for extra "Magic" */}
                <Sparkles count={15} scale={5} size={6} speed={0.1} opacity={0.8} color="#ffffaa" />
            </Float>
        </group>
    );
};

export default Star;
