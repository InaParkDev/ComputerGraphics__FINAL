import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, vec4 } from 'three/tsl'

function Triangle() {
    const ref = useRef<THREE.Mesh>(null!)

    const geometry = useMemo(() => {
        const geo = new THREE.BufferGeometry()
        const s = 1.5, h = (Math.sqrt(3) / 2) * s
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0, h * 0.667, 0,
            -s / 2, -h * 0.333, 0,
            s / 2, -h * 0.333, 0,
        ]), 3))
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
        ]), 3))
        geo.setIndex([0, 1, 2])
        return geo
    }, [])

    const material = useMemo(() => {
        const mat = new MeshBasicNodeMaterial()
        mat.colorNode = vec4(attribute('color', 'vec3') as any, 1.0)
        return mat
    }, [])

    useFrame((_, delta) => { ref.current.rotation.z -= delta * 0.8 })

    return <mesh ref={ref} geometry={geometry} material={material} />
}

export default function App() {
    return (
        <Canvas
            gl={async (props) => {
                const r = new WebGPURenderer({ ...props as any, antialias: true })
                await r.init()
                return r as unknown as THREE.WebGLRenderer
            }}
            camera={{ position: [0, 0, 4], fov: 50 }}
            style={{ width: '100vw', height: '100vh', background: '#0a0a0f' }}
        >
            <Triangle />
        </Canvas>
    )
}
