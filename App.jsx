import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 1. 회전하는 무지개 삼각형 컴포넌트
function RotatingTriangle() {
  const meshRef = useRef();

  // 정점 데이터 (XYZ) 및 색상 데이터 (RGB) 선언
  const [vertices, colors] = useMemo(() => {
    const v = new Float32Array([
       0.0,  0.4, 0.0,  // 상단 정점
       0.4, -0.4, 0.0,  // 우하단 정점
      -0.4, -0.4, 0.0   // 좌하단 정점
    ]);
    const c = new Float32Array([
      1.0, 0.0, 0.0,    // 빨강
      0.0, 1.0, 0.0,    // 초록
      0.0, 0.0, 1.0     // 파랑
    ]);
    return [v, c];
  }, []);

  // 매 프레임 Z축 회전 애니메이션 (기존 원본 코드들과 완벽 일치)
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.z += 0.01;
    }
  });

  return (
    <mesh ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[vertices, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
        />
      </bufferGeometry>
      {/* WebGPU 환경에서 완벽히 작동하는 기초 메테리얼 
        vertexColors 옵션으로 정점의 무지개 그라데이션을 표현합니다.
      */}
      <meshBasicMaterial vertexColors={true} side={THREE.DoubleSide} />
    </mesh>
  );
}

// 2. 메인 App 컴포넌트
export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000000' }}>
      {/* R3F 내부 WebGL/WebGPU 충돌을 방지하기 위해 
        가장 안정적인 기본 캔버스 파이프라인 위에 뷰포트를 직교(Orthographic)로 맞춥니다.
      */}
      <Canvas
        orthographic
        camera={{
          left: -1,
          right: 1,
          top: 1,
          bottom: -1,
          near: 0.1,
          far: 10,
          position: [0, 0, 1]
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance" // 그래픽 카드 가속 강제 선언
        }}
      >
        <RotatingTriangle />
      </Canvas>
    </div>
  );
}