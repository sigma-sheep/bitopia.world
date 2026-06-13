import * as THREE from "three";

// Fixed isometric camera. Orthographic (no perspective foreshortening) looking
// at the target from the equal (1,1,1) direction → true isometric: 45° azimuth,
// ~35.26° elevation. The camera never rotates; only the frustum reframes on
// resize. To raise the camera *without* breaking iso, raise the target's Y (the
// camera moves with it, so the viewing direction stays (1,1,1)); this just pans
// the framing vertically.
const VIEW_HEIGHT = 32; // world units shown vertically; tune to frame the room

// Aim above the floor (≈ mid wall height) so the room sits framed and the back
// walls don't clip the top of the view.
export function makeIsoCamera(
  aspect: number,
  target = new THREE.Vector3(10, 4, 10),
): THREE.OrthographicCamera {
  const halfH = VIEW_HEIGHT / 2;
  const halfW = halfH * aspect;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
  // Equal X/Y/Z offset = true isometric. Distance is irrelevant for an ortho
  // camera; pick something well outside the room.
  cam.position.set(target.x + 100, target.y + 100, target.z + 100);
  cam.lookAt(target);
  return cam;
}

export function resizeIsoCamera(cam: THREE.OrthographicCamera, aspect: number): void {
  const halfH = VIEW_HEIGHT / 2;
  const halfW = halfH * aspect;
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.updateProjectionMatrix();
}
