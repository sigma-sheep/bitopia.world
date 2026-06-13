import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Entity } from "shared/types";
import { avatarSeedToColor } from "shared/avatar";
import { Room } from "../world/Room";
import { buildRoom } from "./RoomRenderer";
import { Character } from "./Character";
import { makeIsoCamera, resizeIsoCamera } from "./isoCamera";
import { connectRoom } from "../net/room";

// Owns the three.js scene, the fixed iso camera, and the render loop. Mounts a
// canvas into a div it controls and cleans everything up on unmount. The render
// loop runs every frame so moving entities can be added later without rework.
export function WorldCanvas({ token }: { token?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let width = mount.clientWidth;
    let height = mount.clientHeight;

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

    // One Character per server Entity, keyed by id. The server owns identity,
    // color (from avatarSeed) and spawn, so every client renders the same world.
    const characters = new Map<string, Character>();
    const addEntity = (e: Entity) => {
      if (characters.has(e.id)) return;
      const character = new Character(e.id, avatarSeedToColor(e.avatarSeed), e.pos);
      character.setResolution(width, height);
      scene.add(character.mesh);
      characters.set(e.id, character);
    };
    const removeEntity = (id: string) => {
      const character = characters.get(id);
      if (!character) return;
      scene.remove(character.mesh);
      characters.delete(id);
    };

    const disconnect = connectRoom(
      {
        onSnapshot: (entities) => entities.forEach(addEntity),
        onJoined: addEntity,
        onLeft: removeEntity,
      },
      token
    );

    let raf = 0;
    const renderLoop = () => {
      renderer.render(scene, camera);
      raf = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    const onResize = () => {
      width = mount.clientWidth;
      height = mount.clientHeight;
      renderer.setSize(width, height);
      resizeIsoCamera(camera, width / height);
      characters.forEach((c) => c.setResolution(width, height));
    };
    window.addEventListener("resize", onResize);

    return () => {
      disconnect();
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [token]);

  return <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />;
}
