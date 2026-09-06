/*
 * Interactive 3D cloud — decorative flourish only, independent of real
 * weather data (the flat SVG icon next to it is what actually reflects
 * current conditions).
 *
 * Adapted from "Animated 3D Weather Widget" by Techartist
 * (https://codepen.io/VoXelo/pen/XJJwjqO), MIT License. Trimmed down to a
 * single small cloud with lighter geometry/raindrop counts to keep it
 * cheap to render at ~90px in a page corner on modest mobile hardware.
 */

const container = document.getElementById("hero-cloud-3d");

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
  } catch (e) {
    return false;
  }
}

if (container && supportsWebGL()) {
  initCloud3D(container).catch((error) => {
    console.warn("3D cloud skipped:", error);
  });
} else if (container) {
  container.style.display = "none";
}

async function initCloud3D(el) {
  const THREE = await import("https://esm.sh/three@0.160.0");
  const { OrbitControls } = await import("https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js");

  const rect = el.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
  camera.position.set(0, 0.4, 4.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(rect.width || 90, rect.height || 90);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  el.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
  dirLight.position.set(2, 3, 2);
  scene.add(dirLight);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.rotateSpeed = 0.7;
  orbit.enableZoom = false;
  orbit.enablePan = false;
  orbit.minPolarAngle = Math.PI / 3;
  orbit.maxPolarAngle = Math.PI / 1.8;

  const cloudMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf0f8ff,
    transparent: true,
    opacity: 0.9,
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.3,
  });

  const cloudGroup = new THREE.Group();
  scene.add(cloudGroup);

  const parts = [
    { r: 0.75, p: [0, 0, 0] },
    { r: 0.55, p: [0.65, 0.15, 0.1] },
    { r: 0.5, p: [-0.6, 0.1, -0.15] },
    { r: 0.6, p: [0.1, 0.35, -0.25] },
    { r: 0.45, p: [0.3, -0.25, 0.15] },
    { r: 0.5, p: [-0.35, -0.2, 0.25] },
  ];
  parts.forEach(({ r, p }) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14), cloudMaterial);
    mesh.position.set(...p);
    cloudGroup.add(mesh);
  });

  const bobOffset = Math.random() * Math.PI * 2;
  const originalY = cloudGroup.position.y;

  // Rain (hidden until the cloud is clicked)
  const rainGroup = new THREE.Group();
  cloudGroup.add(rainGroup);
  const rainMaterial = new THREE.MeshBasicMaterial({ color: 0x9fd7ff, transparent: true, opacity: 0.75 });
  const raindrops = [];
  for (let i = 0; i < 14; i++) {
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 5), rainMaterial);
    drop.position.set((Math.random() - 0.5) * 1.6, -0.7 - Math.random() * 1.3, (Math.random() - 0.5) * 1.6);
    raindrops.push(drop);
    rainGroup.add(drop);
  }
  rainGroup.visible = false;
  let isRaining = false;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById("cloud-tooltip");

  renderer.domElement.addEventListener("click", (event) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    if (raycaster.intersectObjects(cloudGroup.children, true).length > 0) {
      isRaining = !isRaining;
      rainGroup.visible = isRaining;

      const original = cloudGroup.scale.clone();
      cloudGroup.scale.multiplyScalar(1.12);
      setTimeout(() => cloudGroup.scale.copy(original), 150);
    }
  });

  if (tooltip) {
    setTimeout(() => {
      tooltip.classList.add("is-visible");
      setTimeout(() => tooltip.classList.remove("is-visible"), 3000);
    }, 1200);
  }

  let destroyed = false;

  function animate() {
    if (destroyed) return;
    requestAnimationFrame(animate);

    const t = Date.now();
    cloudGroup.rotation.y += 0.0025;
    cloudGroup.position.y = originalY + Math.sin(t * 0.0007 + bobOffset) * 0.12;

    if (isRaining) {
      raindrops.forEach((drop) => {
        drop.position.y -= 0.07;
        if (drop.position.y < -1.6) {
          drop.position.y = -0.7;
          drop.position.x = (Math.random() - 0.5) * 1.6;
          drop.position.z = (Math.random() - 0.5) * 1.6;
        }
      });
    }

    orbit.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    const newRect = el.getBoundingClientRect();
    if (newRect.width > 0 && newRect.height > 0) {
      camera.aspect = newRect.width / newRect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(newRect.width, newRect.height);
    }
  });
}
