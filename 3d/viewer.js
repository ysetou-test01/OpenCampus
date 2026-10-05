import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function startViewer() {
  const container = document.querySelector('#viewer');
  const status = document.querySelector('#status');
  const resetButton = document.querySelector('#reset-view');
  const rotateButton = document.querySelector('#auto-rotate');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getComputedStyle(container).getPropertyValue('--viewer-background').trim() || '#0f172a');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '電子棟。ドラッグで回転、ホイールで拡大縮小、矢印キーで移動');

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = 0.6;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7c8a9b, 0.8));
  const sunlight = new THREE.DirectionalLight(0xffffff, 2);
  sunlight.position.set(5, 10, 7);
  scene.add(sunlight);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(8, 6, 10);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1;
  controls.listenToKeyEvents(renderer.domElement);
  let modelRadius = 0;

  // Bounding sphere + narrower field of view keeps any model size in frame.
  function resetView() {
    if (!modelRadius) return;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = modelRadius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.15;
    controls.autoRotate = false;
    rotateButton.setAttribute('aria-pressed', 'false');
    controls.target.set(0, 0, 0);
    camera.position.copy(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance));
    camera.near = modelRadius / 1000;
    camera.far = Math.max(distance * 4, modelRadius * 100);
    camera.updateProjectionMatrix();
    controls.minDistance = modelRadius * 0.1;
    controls.maxDistance = Math.max(distance * 3, modelRadius * 20);
    controls.update();
    controls.saveState();
  }

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  // Refit after a viewport change so portrait screens still show the whole building.
  const observer = new ResizeObserver(() => {
    resize();
    resetView();
  });
  observer.observe(container);
  resetButton.addEventListener('click', () => {
    // Clear accumulated damping before restoring the initial view.
    controls.enableDamping = false;
    controls.update();
    resetView();
    controls.enableDamping = true;
  });
  rotateButton.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    rotateButton.setAttribute('aria-pressed', String(controls.autoRotate));
  });
  let previousTime;
  renderer.setAnimationLoop((time) => {
    const delta = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.1);
    previousTime = time;
    controls.update(delta);
    renderer.render(scene, camera);
  });

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync(container.dataset.model, (event) => {
      if (event.lengthComputable) {
        status.textContent = `電子棟を読み込んでいます… ${Math.round(event.loaded / event.total * 100)}%`;
      }
    });
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (bounds.isEmpty() || !Number.isFinite(sphere.radius) || sphere.radius <= 0) {
      throw new Error('モデルに表示可能な形状がありません。');
    }
    // Use a parent group to preserve the model's original transforms.
    const centeredModel = new THREE.Group();
    centeredModel.add(model);
    centeredModel.position.copy(sphere.center).negate();
    scene.add(centeredModel);
    modelRadius = sphere.radius;
    resetView();
    resetButton.disabled = false;
    rotateButton.disabled = false;
    status.textContent = '電子棟の読み込みが完了しました。';
    status.hidden = true;
  } catch (error) {
    console.error('電子棟の読み込みに失敗しました:', error);
    status.dataset.state = 'error';
    status.textContent = '電子棟を読み込めませんでした。3d/models/denshito.glb が配置されているか、ファイルが正しい GLB 形式かを確認してから再読み込みしてください。';
  } finally {
    draco.dispose();
  }
}
