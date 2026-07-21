import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

function material(color, metalness = 0.25, roughness = 0.55) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function shadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(width, height, depth, color, metalness, roughness) {
  return shadow(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color, metalness, roughness)));
}

function cylinder(radius, height, color, radialSegments = 24) {
  return shadow(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), material(color, .45, .42)));
}

function terrainHeight(environment, x, z) {
  const id = environment?.id || '';
  if (id === 'himalayan' || /mountain|ridge/i.test(environment?.terrain || '')) {
    const ridge = Math.sin(x * .075) * 5.8 + Math.cos(z * .09) * 4.2;
    const detail = Math.sin((x + z) * .19) * 1.4 + Math.cos((x - z) * .14) * 1.1;
    return ridge + detail - 4;
  }
  if (id === 'urban-canyon' || /urban|building|city/i.test(environment?.terrain || '')) return Math.sin(x * .08) * .25;
  if (environment?.body && environment.body !== 'Earth') return Math.sin(x * .12) * 1.3 + Math.cos(z * .16) * 1.1;
  return Math.sin(x * .08) * 1.1 + Math.cos(z * .075) * .8;
}

function makeDrone(rotors) {
  const group = new THREE.Group();
  const carbon = material(0x202a31, .72, .28);
  const accent = material(0x35d4c2, .32, .36);
  const body = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.8, .72, 2.1), carbon));
  body.position.y = .45;
  group.add(body);
  const top = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.65, .48, 1.25), accent));
  top.position.y = 1.02;
  group.add(top);
  [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]].forEach(([x, z]) => {
    const arm = box(4.4, .18, .22, 0x303b43, .75, .28);
    arm.rotation.y = Math.atan2(z, x);
    arm.position.y = .55;
    group.add(arm);
    const motor = cylinder(.34, .4, 0x11181d, 28);
    motor.position.set(x, .75, z);
    group.add(motor);
    const rotor = box(2.8, .035, .14, 0xa9f5eb, .05, .22);
    rotor.position.set(x, 1.02, z);
    rotor.userData.spinDirection = x * z > 0 ? 1 : -1;
    rotors.push(rotor);
    group.add(rotor);
  });
  const camera = cylinder(.35, .55, 0x0b1116, 24);
  camera.rotation.x = Math.PI / 2;
  camera.position.set(0, -.28, -1.2);
  group.add(camera);
  [-.9, .9].forEach((x) => {
    const leg = box(.1, 1.15, .12, 0x252f35, .7, .35);
    leg.position.set(x, -.55, 0);
    group.add(leg);
    const skid = box(1.8, .1, .12, 0x252f35, .7, .35);
    skid.rotation.y = Math.PI / 2;
    skid.position.set(x, -1.08, 0);
    group.add(skid);
  });
  group.scale.setScalar(.78);
  return group;
}

function makeRover(wheels) {
  const group = new THREE.Group();
  const body = box(4.4, 1.2, 3.05, 0x315a68, .52, .4);
  body.position.y = 1.35;
  group.add(body);
  const deck = box(3.5, .38, 2.5, 0xaec5cc, .68, .28);
  deck.position.y = 2.18;
  group.add(deck);
  [-1.65, 0, 1.65].forEach((x) => [-1.72, 1.72].forEach((z) => {
    const wheel = cylinder(.72, .48, 0x171b1e, 28);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, .72, z);
    wheels.push(wheel);
    group.add(wheel);
  }));
  const mast = cylinder(.12, 2.1, 0x889aa0, 18);
  mast.position.set(.8, 3.25, 0);
  group.add(mast);
  const lidar = cylinder(.56, .35, 0x1d252b, 32);
  lidar.position.set(.8, 4.35, 0);
  group.add(lidar);
  const cameraBar = box(.5, .38, 1.5, 0x10181d, .4, .35);
  cameraBar.position.set(-.65, 3, 0);
  group.add(cameraBar);
  group.scale.setScalar(.68);
  return group;
}

function limb(length, thickness, color) {
  const mesh = box(thickness, length, thickness, color, .35, .5);
  mesh.geometry.translate(0, -length / 2, 0);
  return mesh;
}

function makeHumanoid(limbs) {
  const group = new THREE.Group();
  const pelvis = box(1.2, .65, .7, 0x4a3d75, .42, .38);
  pelvis.position.y = 3.65;
  group.add(pelvis);
  const torso = box(1.55, 2.05, .82, 0x7562b6, .4, .36);
  torso.position.y = 5.05;
  group.add(torso);
  const head = cylinder(.5, .85, 0xc8c1ed, 28);
  head.position.y = 6.75;
  group.add(head);
  [-.48, .48].forEach((x, index) => {
    const hip = new THREE.Group();
    hip.position.set(x, 3.35, 0);
    const upper = limb(1.65, .42, 0x62539a);
    const knee = new THREE.Group();
    knee.position.y = -1.62;
    const lower = limb(1.6, .35, 0x8a7aca);
    knee.add(lower);
    hip.add(upper, knee);
    hip.userData.side = index ? 1 : -1;
    limbs.push({ hip, knee });
    group.add(hip);
  });
  [-1.05, 1.05].forEach((x, index) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 5.65, 0);
    shoulder.add(limb(1.75, .3, 0x8a7aca));
    shoulder.userData.side = index ? 1 : -1;
    limbs.push({ shoulder });
    group.add(shoulder);
  });
  group.scale.setScalar(.78);
  return group;
}

function makeSpacecraft() {
  const group = new THREE.Group();
  group.add(box(2.5, 2.5, 2.5, 0xc8a85c, .72, .28));
  [-3.5, 3.5].forEach((x) => {
    const panel = box(4.2, .12, 2.05, 0x183d73, .55, .32);
    panel.position.x = x;
    group.add(panel);
  });
  const dish = cylinder(.7, .22, 0xd8dce0, 32);
  dish.position.y = 1.55;
  group.add(dish);
  group.scale.setScalar(.72);
  return group;
}

export class ProvingGround3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8eb7c8);
    this.scene.fog = new THREE.FogExp2(0x8eb7c8, .009);
    this.camera = new THREE.PerspectiveCamera(48, 1, .1, 800);
    this.camera.position.set(-22, 16, 24);
    this.scene.add(new THREE.HemisphereLight(0xd9f2ff, 0x30443f, 1.65));
    const sun = new THREE.DirectionalLight(0xfff4d6, 3.1);
    sun.position.set(-28, 42, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    this.scene.add(sun);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.machine = null;
    this.terrain = null;
    this.environmentKey = '';
    this.family = '';
    this.rotors = [];
    this.wheels = [];
    this.limbs = [];
    this.imported = false;
    this.path = null;
    this.target = null;
    this.cameraMode = 'chase';
    this.orbitYaw = -.72;
    this.orbitPitch = .34;
    this.orbitDistance = 28;
    this.previous = { t: 0, altitude: 0, worldX: 0, worldZ: 0 };
    this.loader = new GLTFLoader();
    this.bindPointerControls();
  }

  bindPointerControls() {
    let dragging = false;
    let previousX = 0;
    let previousY = 0;
    this.canvas.addEventListener('pointerdown', (event) => { dragging = true; previousX = event.clientX; previousY = event.clientY; this.canvas.setPointerCapture(event.pointerId); });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      this.cameraMode = 'orbit';
      this.orbitYaw -= (event.clientX - previousX) * .008;
      this.orbitPitch = clamp(this.orbitPitch + (event.clientY - previousY) * .006, .08, 1.18);
      previousX = event.clientX; previousY = event.clientY;
      this.canvas.dispatchEvent(new CustomEvent('camera-mode-change', { detail: { mode: 'orbit' } }));
    });
    this.canvas.addEventListener('pointerup', () => { dragging = false; });
    this.canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.cameraMode = 'orbit'; this.orbitDistance = clamp(this.orbitDistance + event.deltaY * .02, 10, 58); }, { passive: false });
  }

  setCameraMode(mode) { this.cameraMode = ['chase', 'orbit', 'side', 'top'].includes(mode) ? mode : 'chase'; }

  rebuildWorld(environment, profile) {
    const key = `${environment?.id}|${environment?.body}|${environment?.terrain}`;
    if (key === this.environmentKey && this.path) return;
    this.environmentKey = key;
    if (this.terrain) this.world.remove(this.terrain);
    if (this.path) this.world.remove(this.path);
    if (this.target) this.world.remove(this.target);
    const size = 140;
    const geometry = new THREE.PlaneGeometry(size, size, 96, 96);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) positions.setY(index, terrainHeight(environment, positions.getX(index), positions.getZ(index)));
    geometry.computeVertexNormals();
    const nonEarth = environment?.body && environment.body !== 'Earth';
    const terrainMaterial = material(nonEarth ? 0x8d725b : environment?.id === 'himalayan' ? 0x496158 : 0x496b53, .02, .96);
    this.terrain = shadow(new THREE.Mesh(geometry, terrainMaterial));
    this.world.add(this.terrain);
    if (/urban|building|city/i.test(environment?.terrain || '')) {
      for (let index = 0; index < 25; index += 1) {
        const x = -58 + (index % 5) * 28;
        const z = -58 + Math.floor(index / 5) * 28;
        const height = 7 + (index * 13 % 18);
        const building = box(8 + (index % 3), height, 9, 0x526873, .2, .72);
        building.position.set(x, terrainHeight(environment, x, z) + height / 2, z);
        this.world.add(building);
      }
    }
    const map = (point, aerial = false) => {
      const x = (point.x - 50) * 1.2;
      const z = (point.y - 50) * 1.2;
      const y = terrainHeight(environment, x, z) + (aerial ? Math.max(4, (point.altitude || profile.initial.altitude || 24) * .34) : .18);
      return new THREE.Vector3(x, y, z);
    };
    const aerial = String(profile.family).toLowerCase() === 'aerial';
    const points = [map(profile.initial, aerial), map({ ...profile.target, altitude: profile.initial.altitude }, aerial)];
    this.path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0xcdeff7, dashSize: 1.4, gapSize: .8, transparent: true, opacity: .82 }));
    this.path.computeLineDistances();
    this.world.add(this.path);
    this.target = new THREE.Mesh(new THREE.TorusGeometry(2, .14, 12, 48), new THREE.MeshBasicMaterial({ color: 0x68a8ff }));
    this.target.rotation.x = Math.PI / 2;
    this.target.position.copy(points[1]);
    this.world.add(this.target);
  }

  clearMachine() {
    if (this.machine) this.world.remove(this.machine);
    this.machine = null;
    this.rotors = [];
    this.wheels = [];
    this.limbs = [];
    this.imported = false;
  }

  ensureMachine(family) {
    if (this.machine && this.family === family) return;
    this.clearMachine();
    this.family = family;
    this.machine = family === 'aerial' ? makeDrone(this.rotors) : family === 'ground' ? makeRover(this.wheels) : family === 'legged' ? makeHumanoid(this.limbs) : makeSpacecraft();
    this.world.add(this.machine);
  }

  useProceduralMachine(family) {
    this.clearMachine();
    this.family = '';
    this.ensureMachine(family);
  }

  async loadUploadedGeometry(files, family) {
    const file = [...files].find((item) => /\.(glb|gltf)$/i.test(item.name));
    if (!file) return { loaded: false, reason: 'No glTF or GLB geometry was included.' };
    const url = URL.createObjectURL(file);
    try {
      const gltf = await this.loader.loadAsync(url);
      this.clearMachine();
      this.family = family;
      this.machine = gltf.scene;
      this.imported = true;
      const bounds = new THREE.Box3().setFromObject(this.machine);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      this.machine.position.sub(center);
      const scale = 6 / Math.max(size.x, size.y, size.z, .001);
      this.machine.scale.setScalar(scale);
      this.machine.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
      this.world.add(this.machine);
      return { loaded: true, name: file.name };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const expectedWidth = Math.round(width * pixelRatio);
    const expectedHeight = Math.round(height * pixelRatio);
    if (this.canvas.width !== expectedWidth || this.canvas.height !== expectedHeight) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  update(snapshot, { environment, profile, family }) {
    this.resize();
    this.rebuildWorld(environment, profile);
    this.ensureMachine(family);
    const x = (snapshot.x - 50) * 1.2;
    const z = (snapshot.y - 50) * 1.2;
    const ground = terrainHeight(environment, x, z);
    let y = ground;
    if (family === 'aerial') y += Math.max(1.2, snapshot.altitude * .34);
    else if (family === 'spacecraft') y += 18 + snapshot.altitude * .08;
    else y += family === 'legged' ? .08 : .5;
    const smoothing = snapshot.t === 0 ? 1 : .22;
    this.machine.position.x = lerp(this.machine.position.x, x, smoothing);
    this.machine.position.y = lerp(this.machine.position.y, y, smoothing);
    this.machine.position.z = lerp(this.machine.position.z, z, smoothing);
    const headingRadians = snapshot.heading * Math.PI / 180;
    // Procedural humanoid is authored facing +Z. Route heading zero means +X,
    // so it needs a +90 degree basis offset rather than the generic 180 degree offset.
    this.machine.rotation.y = family === 'legged' ? Math.PI / 2 - headingRadians : -headingRadians + Math.PI;
    if (family === 'aerial') {
      this.machine.rotation.z = snapshot.attitude * Math.PI / 180 * .38;
      this.rotors.forEach((rotor) => { rotor.rotation.y += .72 * rotor.userData.spinDirection; });
    } else if (family === 'ground') {
      this.machine.rotation.z = 0;
      const distance = Math.hypot(x - this.previous.worldX, z - this.previous.worldZ);
      this.wheels.forEach((wheel) => { wheel.rotation.z -= distance * .8; });
    } else if (family === 'legged') {
      const speed = Math.hypot(snapshot.vx, snapshot.vy);
      const gaitStrength = speed < .08 ? 0 : clamp(speed / 1.8, 0, 1);
      const gait = Math.sin(snapshot.t * 4.4) * .38 * gaitStrength;
      this.limbs.forEach((entry) => {
        if (entry.hip) { entry.hip.rotation.x = gait * entry.hip.userData.side; entry.knee.rotation.x = Math.max(0, -gait * entry.hip.userData.side) * .75; }
        if (entry.shoulder) entry.shoulder.rotation.x = -gait * entry.shoulder.userData.side;
      });
    }
    this.updateCamera(snapshot, new THREE.Vector3(x, y, z));
    this.target.rotation.z += .008;
    this.renderer.render(this.scene, this.camera);
    const dt = Math.max(.001, snapshot.t - this.previous.t);
    const verticalSpeed = snapshot.t > this.previous.t ? (snapshot.altitude - this.previous.altitude) / dt : 0;
    this.previous = { t: snapshot.t, altitude: snapshot.altitude, worldX: x, worldZ: z };
    return { groundHeight: ground, worldAltitude: y, agl: family === 'aerial' ? Math.max(0, snapshot.altitude) : 0, verticalSpeed };
  }

  updateCamera(snapshot, focus) {
    let desired;
    if (this.cameraMode === 'top') desired = focus.clone().add(new THREE.Vector3(0, 44, .01));
    else if (this.cameraMode === 'side') desired = focus.clone().add(new THREE.Vector3(25, 8, 0));
    else if (this.cameraMode === 'orbit') desired = focus.clone().add(new THREE.Vector3(Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * this.orbitDistance, Math.sin(this.orbitPitch) * this.orbitDistance + 3, Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * this.orbitDistance));
    else {
      const heading = -snapshot.heading * Math.PI / 180;
      desired = focus.clone().add(new THREE.Vector3(-Math.sin(heading) * 17, 8.5, -Math.cos(heading) * 17));
    }
    this.camera.position.lerp(desired, .085);
    this.camera.lookAt(focus.clone().add(new THREE.Vector3(0, 1.1, 0)));
  }
}
