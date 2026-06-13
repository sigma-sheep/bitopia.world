import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Room } from "../world/Room";
import { buildRoom } from "./RoomRenderer";
import { Character } from "./Character";
import { makeIsoCamera, resizeIsoCamera } from "./isoCamera";

// Owns the three.js scene, the fixed iso camera, and the render loop. Mounts a
// canvas into a div it controls and cleans everything up on unmount. The render
// loop runs every frame so moving entities can be added later without rework.
export function WorldCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x11151c);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = makeIsoCamera(width / height);

    scene.add(new THREE.AmbientLight(0xffffff, 5.0));
    // Key light from the camera's corner: same (1,1,1) direction the camera
    // looks along, so every face the camera sees is lit (no dark visible walls).
    // Direction is what matters for a directional light, so position = (1,1,1).
    const cornerLight = new THREE.DirectionalLight(0xffffff, 1.0);
    cornerLight.position.set(100, 100, 100);
    scene.add(cornerLight);

    const room = Room.grid(20, 20);
    scene.add(buildRoom(room));

    // Spawn one character at a random floor position with a random color, inset
    // from the walls (later: one per server Entity).
    const margin = 2;
    const spawn = {
      x: margin + Math.random() * (room.width - 2 * margin),
      y: margin + Math.random() * (room.height - 2 * margin),
    };
    const character = new Character("self", Character.randomColor(), spawn);
    character.setResolution(width, height);
    scene.add(character.mesh);

    let raf = 0;
    const renderLoop = () => {
      renderer.render(scene, camera);
      raf = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      resizeIsoCamera(camera, w / h);
      character.setResolution(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />;
}
