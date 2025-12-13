import React, { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

type BoxColor = 'black' | 'white';

interface LuxuryGiftBoxProps {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
    color: BoxColor;
}

const LuxuryGiftBox: React.FC<LuxuryGiftBoxProps> = ({ position, rotation, scale, color }) => {
    const boxMaterial = useMemo(() => {
        return new THREE.MeshStandardMaterial({
            color: color === 'black' ? '#111111' : '#f5f5f5',
            roughness: 0.8, // Matte finish
            metalness: 0.1,
        });
    }, [color]);

    const ribbonMaterial = useMemo(() => {
        return new THREE.MeshStandardMaterial({
            color: '#ffd700',
            roughness: 0.2,
            metalness: 1.0, // Glossy Gold
            emissive: '#b8860b',
            emissiveIntensity: 0.2,
        });
    }, []);

    return (
        <group position={position} rotation={rotation as any} scale={scale}>
            {/* Box with bevels */}
            <RoundedBox args={[1, 1, 1]} radius={0.05} smoothness={4} material={boxMaterial}>
                {/* Shadows are handled by the scene lights */}
            </RoundedBox>

            {/* Ribbon - Vertical Band */}
            <mesh position={[0, 0, 0]} scale={[1.02, 1.02, 0.15]}>
                <boxGeometry />
                <primitive object={ribbonMaterial} attach="material" />
            </mesh>

            {/* Ribbon - Horizontal Band */}
            <mesh position={[0, 0, 0]} scale={[0.15, 1.02, 1.02]}>
                <boxGeometry />
                <primitive object={ribbonMaterial} attach="material" />
            </mesh>

            {/* Bow knot on top */}
            <group position={[0, 0.5, 0]}>
                <mesh rotation={[0, 0, Math.PI / 4]} position={[0, 0.1, 0]} scale={[0.4, 0.1, 0.15]}>
                    <cylinderGeometry args={[1, 1, 1, 32]} />
                    <primitive object={ribbonMaterial} attach="material" />
                </mesh>
                <mesh rotation={[0, 0, -Math.PI / 4]} position={[0, 0.1, 0]} scale={[0.4, 0.1, 0.15]}>
                    <cylinderGeometry args={[1, 1, 1, 32]} />
                    <primitive object={ribbonMaterial} attach="material" />
                </mesh>
            </group>
        </group>
    );
};

export default LuxuryGiftBox;
