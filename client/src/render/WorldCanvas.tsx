import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Entity, Facing } from "shared/types";
import { avatarSeedToColor } from "shared/avatar";
import { Room } from "../world/Room";
import { FloorTile } from "../world/FloorTile";
import { buildRoom } from "./RoomRenderer";
import { Character } from "./Character";
import { makeIsoCamera, resizeIsoCamera } from "./isoCamera";
import { connectRoom } from "../net/room";
import { ChatInput } from "../ui/ChatInput";

// Dominant-axis facing from one ground point to another. +X → E, +Z → S, to
// match Vec2.y → world Z and the iso camera looking from the +X/+Z corner.
function facingFromTo(fx: number, fz: number, tx: number, tz: number): Facing {
  const dx = tx - fx;
  const dz = tz - fz;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? "E" : "W";
  return dz >= 0 ? "S" : "N";
}

// Owns the three.js scene, the fixed iso camera, and the render loop. Mounts a
// canvas into a div it controls and cleans everything up on unmount. The render
// loop runs every frame so moving entities can be added later without rework.
// How long a chat bubble stays up before fading away.
const BUBBLE_MS = 5000;
// Extra height above the head so the bubble clears the nameplate sprite.
const BUBBLE_WORLD_OFFSET = Character.SIZE.h / 2 + 1.6;

export function WorldCanvas({ token }: { token?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Lets the React-rendered ChatInput reach the imperative socket send.
  const sendChatRef = useRef<((text: string) => void) | null>(null);

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
      const character = new Character(e.id, avatarSeedToColor(e.avatarSeed), e.pos, e.displayName);
      character.setResolution(width, height);
      scene.add(character.mesh);
      characters.set(e.id, character);
    };
    // Speech bubbles live in a DOM layer over the canvas (crisp text, easy
    // styling), positioned imperatively each frame in the render loop. One bubble
    // per sender, keyed by id; a new message from the same sender replaces it.
    const bubbleLayer = document.createElement("div");
    Object.assign(bubbleLayer.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    mount.appendChild(bubbleLayer);
    const bubbles = new Map<string, { el: HTMLDivElement; expiresAt: number }>();

    const removeBubble = (id: string) => {
      const bubble = bubbles.get(id);
      if (!bubble) return;
      bubble.el.remove();
      bubbles.delete(id);
    };

    const removeEntity = (id: string) => {
      const character = characters.get(id);
      if (!character) return;
      scene.remove(character.mesh);
      characters.delete(id);
      removeBubble(id);
    };

    // Identity of the local player (from `welcome`) so clicks move our own avatar.
    let selfId: string | null = null;

    const { sendMove, sendChat, disconnect } = connectRoom(
      {
        onSnapshot: (entities) => entities.forEach(addEntity),
        onJoined: addEntity,
        onLeft: removeEntity,
        onMoved: (id, pos) => characters.get(id)?.moveTo(pos),
        onWelcome: (id) => { selfId = id; },
        onChat: ({ senderId, text }) => {
          let bubble = bubbles.get(senderId);
          if (!bubble) {
            const el = document.createElement("div");
            Object.assign(el.style, {
              position: "absolute",
              transform: "translate(-50%, -100%)",
              maxWidth: "220px",
              padding: "6px 10px",
              borderRadius: "10px",
              background: "rgba(22, 28, 38, 0.92)",
              border: "1px solid #2a3340",
              color: "#e8eef6",
              fontFamily: "system-ui, sans-serif",
              fontSize: "13px",
              lineHeight: "1.3",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
            } as CSSStyleDeclaration);
            bubbleLayer.appendChild(el);
            bubble = { el, expiresAt: 0 };
            bubbles.set(senderId, bubble);
          }
          bubble.el.textContent = text;
          bubble.expiresAt = performance.now() + BUBBLE_MS;
        },
      },
      token
    );
    sendChatRef.current = sendChat;

    // Click-to-move: raycast the click against the floor's top surface and ask
    // the server to move us there. A math plane (not the floor meshes, which live
    // inside the buildRoom group) is exact for a flat floor and needs no lookup;
    // off-edge hits still produce a point the server clamps into bounds.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FloorTile.SIZE.h);
    const hit = new THREE.Vector3();
    const onClick = (ev: MouseEvent) => {
      if (!selfId) return;
      const self = characters.get(selfId);
      if (!self) return;

      // NDC from CSS pixels (getBoundingClientRect), not the HiDPI backing store.
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return; // ray parallel

      const from = self.mesh.position;
      const facing = facingFromTo(from.x, from.z, hit.x, hit.z);
      sendMove({ x: hit.x, y: hit.z }, facing); // server clamps; no client clamp
    };
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const clock = new THREE.Clock();
    const bubbleAnchor = new THREE.Vector3();
    const renderLoop = () => {
      const dt = clock.getDelta();
      characters.forEach((c) => c.update(dt));

      // Track each bubble above its avatar's head; expire the stale ones. Project
      // the head point to CSS pixels (clientWidth/Height, not the HiDPI backing
      // store) — same convention as onClick's getBoundingClientRect.
      const now = performance.now();
      bubbles.forEach((bubble, id) => {
        const character = characters.get(id);
        if (!character || now >= bubble.expiresAt) {
          removeBubble(id);
          return;
        }
        const p = character.mesh.position;
        bubbleAnchor.set(p.x, p.y + BUBBLE_WORLD_OFFSET, p.z).project(camera);
        if (bubbleAnchor.z > 1) { // behind the camera
          bubble.el.style.display = "none";
          return;
        }
        bubble.el.style.display = "block";
        bubble.el.style.left = `${((bubbleAnchor.x + 1) / 2) * width}px`;
        bubble.el.style.top = `${((1 - bubbleAnchor.y) / 2) * height}px`;
      });

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
      renderer.domElement.removeEventListener("click", onClick);
      disconnect();
      sendChatRef.current = null;
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      bubbles.forEach((b) => b.el.remove());
      bubbles.clear();
      bubbleLayer.remove();
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [token]);

  return (
    <>
      <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />
      <ChatInput onSend={(text) => sendChatRef.current?.(text)} />
    </>
  );
}
