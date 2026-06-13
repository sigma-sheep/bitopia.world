import * as THREE from "three";
import { createRoom } from "./room.js";

// How many world units tall the viewport shows. Sized to fit the 30x30 floor
// plus the 15-tall walls with margin. Lower = zoomed in, higher = zoomed out.
const FRUSTUM_SIZE = 50;

const container = document.getElementById("app");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151c);

// --- Orthographic camera for a true isometric view (no perspective) ---
// Positioned at equal +x/+y/+z and aimed at the room, so the back corner
// recedes and the room opens toward the viewer. Parallel edges stay parallel.
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  (-FRUSTUM_SIZE * aspect) / 2,
  (FRUSTUM_SIZE * aspect) / 2,
  FRUSTUM_SIZE / 2,
  -FRUSTUM_SIZE / 2,
  0.1,
  1000
);
camera.position.set(40, 40, 40);
camera.lookAt(0, 6, 0);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// --- Scene contents ---
scene.add(createRoom());

// --- Resize handling: keep the room centered and unstretched ---
function onResize() {
  const a = window.innerWidth / window.innerHeight;
  camera.left = (-FRUSTUM_SIZE * a) / 2;
  camera.right = (FRUSTUM_SIZE * a) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

// --- Render loop ---
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
