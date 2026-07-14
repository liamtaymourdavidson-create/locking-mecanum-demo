import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* ============================================================
   Locking Mecanum — interactive module viewer
   ============================================================ */

// Two keyframe states: unlocked (shown) and locked. Every part is interpolated between them.
const UNLOCKED_CANDIDATES = [
  "Unlocked.glb",
  "unlocked.glb",
  "https://raw.githubusercontent.com/liamtaymourdavidson-create/locking-mecanum-demo/main/Unlocked.glb",
];
const LOCKED_CANDIDATES = [
  "Locked.glb",
  "locked.glb",
  "https://raw.githubusercontent.com/liamtaymourdavidson-create/locking-mecanum-demo/main/Locked.glb",
];

// Geometry extracted from the GLB (metres).
const PART = {
  wheelCenter: [0.0075, 0, 0],
  wheelAxis: [1, 0, 0],
  sliders: [
    { center: [0.00865, 0.00655, -0.02029], radial: [0, 0.3074, -0.9516] },
    { center: [0.00865, 0.02132, -0.00004], radial: [0, 1.0, -0.0017] },
    { center: [0.00865, -0.01727, -0.0125], radial: [0, -0.81, -0.5864] },
    { center: [0.00865, -0.01723, 0.01256], radial: [0, -0.808, 0.5892] },
    { center: [0.00865, 0.00662, 0.02026], radial: [0, 0.3106, 0.9505] },
  ],
  rollers: [
    { center: [0.0074, -0.0384, -0.01233], axis: [0.7544, 0.202, -0.6245] },
    { center: [0.0074, -0.02381, -0.03255], axis: [0.7544, 0.5305, -0.3865] },
    { center: [0.0074, -0.00014, -0.04033], axis: [0.7544, 0.6564, -0.0009] },
    { center: [0.0074, 0.02359, -0.03271], axis: [0.7544, 0.5315, 0.3851] },
    { center: [0.0074, 0.03831, -0.01259], axis: [0.7544, 0.2037, 0.624] },
    { center: [0.0074, 0.0384, 0.01233], axis: [0.7544, -0.202, 0.6245] },
    { center: [0.0074, 0.02381, 0.03255], axis: [0.7544, -0.5305, 0.3865] },
    { center: [0.0074, 0.00014, 0.04033], axis: [0.7544, -0.6564, 0.0009] },
    { center: [0.0074, -0.02359, 0.03271], axis: [0.7544, -0.5315, -0.3851] },
    { center: [0.0074, -0.03831, 0.01259], axis: [0.7544, -0.2037, -0.624] },
  ],
  keyParts: {
    shaft: [0.03205, 0, 0],
    servo: [0.06979, 0.0246, 0.00725],
    gear96: [0.03455, 0, 0],
    motor: [0.09778, 0.03455, -0.02158],
    innerPlate: [0.04609, 0.01312, -0.00339],
    outerPlate: [-0.01309, -0.00024, 0.00004],
  },
};

const WHEEL_CENTER = new THREE.Vector3(...PART.wheelCenter);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// real travel read from the two keyframe states, for telemetry readouts
const SERVO_DEG = 16.6, WEDGE_MM = 5.46;

/* ---------- renderer / scene / camera ---------- */
const viewer = document.getElementById("viewer");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewer.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 2 });
document.getElementById("labels").appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.005, 100);
camera.up.set(0, 0, 1);              // model is Onshape Z-up
camera.position.set(0.06, -0.28, 0.16);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.09;
controls.maxDistance = 1.2;
controls.target.copy(WHEEL_CENTER);

/* ---------- environment + lights ---------- */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(0.3, 0.45, 0.4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xb060ff, 1.6); // purple rim
rim.position.set(-0.4, 0.2, -0.35);
scene.add(rim);
const fill = new THREE.DirectionalLight(0x66d9ff, 0.7);
fill.position.set(0.1, -0.35, 0.25);
scene.add(fill);

/* ---------- clipping ---------- */
const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
const allMaterials = [];
let capMesh = null;              // solid cross-section cap (stencil)
const stencilMeshes = [];        // per-part front/back stencil writers

/* ---------- state ---------- */
const state = {
  view: "assembled", // assembled | section | exploded
  locked: false,
  labels: true,
  sectionAxis: "face", // face (perp to axle) | axle (through axle)
  sectionFlip: false,
  demo: false,
  slowLock: false,
};
// animated (tweened) values
const anim = { lock: 0, explode: 0, sectionAmt: 0, sectionDepth: 0.5 };

let model = null;      // gltf.scene (unlocked, shown)
let root = null;       // the "Left Slant Module" node holding the parts
const animatedNodes = []; // nodes that differ between unlocked & locked
const rollerMats = [];
const explodeGroups = []; // {obj, home:Vector3, offset:Vector3}
const callouts = [];
let modelBox = new THREE.Box3();
let modelMaxDim = 0.15;

/* ============================================================
   Load — unlocked (shown) + locked (keyframe target)
   ============================================================ */
const loaderEl = document.getElementById("loader");
const pctEl = document.getElementById("loadPct");
const gltfLoader = new GLTFLoader();

function loadAny(list) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const attempt = () => {
      if (i >= list.length) return reject(new Error("not found"));
      gltfLoader.load(
        list[i],
        (g) => resolve(g),
        i === 0 ? (xhr) => { if (xhr.total) pctEl.textContent = Math.round((xhr.loaded / xhr.total) * 100) + "%"; } : undefined,
        () => { i++; attempt(); }
      );
    };
    attempt();
  });
}

loadAny(UNLOCKED_CANDIDATES).then((ug) => {
  loadAny(LOCKED_CANDIDATES)
    .then((lg) => onLoaded(ug, lg))
    .catch(() => onLoaded(ug, null)); // still show the model if locked state is missing
}).catch(() => fail("Couldn't find Unlocked.glb."));

function fail(msg) {
  loaderEl.classList.add("hide");
  const e = document.getElementById("errbox");
  e.hidden = false;
  document.getElementById("errmsg").textContent = " " + msg + " Make sure Unlocked.glb and Locked.glb sit next to index.html.";
}

function onLoaded(gltf, lockedGltf) {
  model = gltf.scene;
  scene.add(model);

  // materials
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      m.metalness = 0.28;
      m.roughness = 0.52;
      m.envMapIntensity = 0.7;
      m.side = THREE.DoubleSide;
      m.clipShadows = true;
      m.clippingPlanes = [];
      if (!allMaterials.includes(m)) allMaterials.push(m);
    });
  });

  root = model.getObjectByName("Left Slant Module") || model.children[0] || model;

  if (lockedGltf) buildKeyframes(lockedGltf.scene);
  buildRollerTint();
  frameModel();
  buildExplodeGroups();
  buildCallouts();
  buildSectionCaps();

  loaderEl.classList.add("hide");
  setView("assembled");
  updateTelemetry();
  if (!reduceMotion) introSweep();
}

/* ---------- diff the two states → per-part keyframes ---------- */
function buildKeyframes(lockedScene) {
  const walk = (a, b) => {
    if (!a || !b) return;
    const dp = a.position.distanceTo(b.position);
    const dq = a.quaternion.angleTo(b.quaternion);
    if (dp > 5e-5 || dq > 5e-3) {
      a.userData.k0 = { p: a.position.clone(), q: a.quaternion.clone() };
      a.userData.k1 = { p: b.position.clone(), q: b.quaternion.clone() };
      animatedNodes.push(a);
    }
    const n = Math.min(a.children.length, b.children.length);
    for (let i = 0; i < n; i++) walk(a.children[i], b.children[i]);
  };
  walk(model, lockedScene);
  // free the locked scene
  lockedScene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose && m.dispose());
  });
}

/* ---------- roller tint (free = teal, locked = purple) ---------- */
function buildRollerTint() {
  model.traverse((mesh) => {
    if (mesh.isMesh && /roller core/i.test(mesh.name)) {
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const c = m.clone();
      c.emissive = new THREE.Color(0x000000);
      mesh.material = c;
      if (!rollerMats.includes(c)) rollerMats.push(c);
      if (!allMaterials.includes(c)) allMaterials.push(c);
    }
  });
}

/* ---------- camera framing ---------- */
function frameModel() {
  modelBox.setFromObject(model);
  const size = modelBox.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z);
  modelMaxDim = maxd;
  const dist = maxd * 1.85;
  // front-top view from slightly motor-side, Z up — matches the CAD screenshot
  const dir = new THREE.Vector3(0.32, -0.9, 0.52).normalize();
  camera.position.copy(WHEEL_CENTER).add(dir.multiplyScalar(dist));
  controls.target.copy(WHEEL_CENTER);
  controls.maxDistance = maxd * 4;
  controls.update();
  saveHome();
}
let camHome = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
function saveHome() { camHome.pos.copy(camera.position); camHome.tgt.copy(controls.target); }

/* ---------- exploded groups ---------- */
function buildExplodeGroups() {
  const wc = WHEEL_CENTER;
  const c = new THREE.Vector3();
  root.children.slice().forEach((child) => {
    if (!child.visible && child.type.includes("Light")) return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    box.getCenter(c);
    const name = child.name || "";
    const radial = new THREE.Vector3(0, c.y - wc.y, c.z - wc.z);
    if (radial.lengthSq() < 1e-9) radial.set(0, 1, 0);
    radial.normalize();
    const dx = c.x - wc.x;
    const off = new THREE.Vector3();

    if (/Mecanum Wheel/i.test(name)) {
      off.set(-0.05, 0, 0);                                    // pull the wheel off the axle
    } else if (/Motor|Mata|Servo/i.test(name)) {
      off.set(0.14, 0, 0).addScaledVector(radial, 0.015);      // motor & servo out the back
    } else if (/Inner Plate/i.test(name)) {
      off.set(0.075, 0, 0);
    } else if (/Outer Plate|Outer Core/i.test(name)) {
      off.set(-0.12, 0, 0);
    } else if (/Inner Core|96t Hub Mount Gear|Gear Mount|Actuation Shaft/i.test(name)) {
      off.set(0.045 + dx * 0.3, 0, 0);                         // hub / gear / shaft stack along the axle
    } else if (/Square Beam/i.test(name)) {
      off.copy(radial).multiplyScalar(0.075); off.x = dx * 0.2; // open the cage outward
    } else if (/Button|Socket|Nut|Locknut|Bearing|spacer|Thrust|Screw|Shoulder/i.test(name)) {
      off.copy(radial).multiplyScalar(0.06); off.x += dx > 0 ? 0.05 : -0.03; // scatter fasteners
    } else {
      off.copy(radial).multiplyScalar(0.035); off.x += dx * 0.5;
    }
    explodeGroups.push({ obj: child, home: child.position.clone(), offset: off });
  });
}

/* ---------- callouts (CSS2D) ---------- */
function makeTag(title, sub, cls) {
  const el = document.createElement("div");
  el.className = "callout " + (cls || "");
  el.innerHTML = `<div class="dot"></div><div class="tag"><b>${title}</b>${sub ? " · " + sub : ""}</div>`;
  const obj = new CSS2DObject(el);
  obj.el = el;
  return obj;
}
function buildCallouts() {
  const defs = [
    { p: PART.keyParts.servo, t: "Lock servo", s: "", c: "" },
    { p: PART.keyParts.shaft, t: "Actuation shaft", s: "slides to lock", c: "" },
    { p: PART.sliders[1].center, t: "Jamming wedge ×5", s: "the lock", c: "" },
    { p: [0.0355, 0.018, -0.010], t: "8T:96T bare motor drive train", s: "", c: "gold" },
    { p: PART.keyParts.motor, t: "Bare goBILDA motor", s: "", c: "" },
  ];
  defs.forEach((d) => {
    const o = makeTag(d.t, d.s, d.c);
    o.position.set(...d.p);
    scene.add(o);
    callouts.push(o);
  });
}

/* ---------- solid section caps via the stencil buffer ---------- */
function buildSectionCaps() {
  const meshes = [];
  model.traverse((o) => { if (o.isMesh && !o.userData.isStencil) meshes.push(o); });

  meshes.forEach((mesh) => {
    const geo = mesh.geometry;
    const base = new THREE.MeshBasicMaterial();
    base.depthWrite = false; base.depthTest = false; base.colorWrite = false;
    base.stencilWrite = true; base.stencilFunc = THREE.AlwaysStencilFunc;

    const backMat = base.clone();
    backMat.side = THREE.BackSide; backMat.clippingPlanes = [clipPlane];
    backMat.stencilFail = THREE.IncrementWrapStencilOp;
    backMat.stencilZFail = THREE.IncrementWrapStencilOp;
    backMat.stencilZPass = THREE.IncrementWrapStencilOp;
    const back = new THREE.Mesh(geo, backMat);
    back.userData.isStencil = true; back.renderOrder = 1; back.frustumCulled = false; back.visible = false;
    mesh.add(back); stencilMeshes.push(back);

    const frontMat = base.clone();
    frontMat.side = THREE.FrontSide; frontMat.clippingPlanes = [clipPlane];
    frontMat.stencilFail = THREE.DecrementWrapStencilOp;
    frontMat.stencilZFail = THREE.DecrementWrapStencilOp;
    frontMat.stencilZPass = THREE.DecrementWrapStencilOp;
    const front = new THREE.Mesh(geo, frontMat);
    front.userData.isStencil = true; front.renderOrder = 1; front.frustumCulled = false; front.visible = false;
    mesh.add(front); stencilMeshes.push(front);
  });

  const dim = modelMaxDim * 1.5;
  const capMat = new THREE.MeshStandardMaterial({
    color: 0x8f84ab, metalness: 0.15, roughness: 0.7, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  });
  capMesh = new THREE.Mesh(new THREE.PlaneGeometry(dim, dim), capMat);
  capMesh.renderOrder = 2; capMesh.frustumCulled = false; capMesh.visible = false;
  scene.add(capMesh);
}

/* ============================================================
   Section maths
   ============================================================ */
function sectionNormal() {
  // face = cut perpendicular to axle (reveals roller ring + wedges)
  // axle = cut through the axle lengthwise (reveals shaft + gears)
  const n = state.sectionAxis === "face" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  if (state.sectionFlip) n.negate();
  return n;
}
function updateClip() {
  const n = sectionNormal();
  const s = modelBox.getSize(new THREE.Vector3());
  let centerAlong, half;
  if (state.sectionAxis === "face") { centerAlong = PART.wheelCenter[0]; half = 0.033; }
  else { centerAlong = 0; half = s.z * 0.5; }
  const along = centerAlong - half + anim.sectionDepth * 2 * half;
  clipPlane.normal.copy(n);
  clipPlane.constant = -n.dot(new THREE.Vector3().copy(sectionAxisVec()).multiplyScalar(along));
  if (capMesh) {
    capMesh.position.copy(sectionAxisVec()).multiplyScalar(along);
    capMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }
}
function sectionAxisVec() {
  return state.sectionAxis === "face" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
}
function setSectionMaterials(on) {
  allMaterials.forEach((m) => { m.clippingPlanes = on ? [clipPlane] : []; });
  stencilMeshes.forEach((m) => (m.visible = on));
  if (capMesh) capMesh.visible = on;
}

/* ============================================================
   View / state transitions
   ============================================================ */
function setView(v) {
  state.view = v;
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  document.getElementById("sectionctl").hidden = v !== "section";
  setSectionMaterials(v === "section");
  if (v === "section") updateClip();
  // labels hidden when exploded (parts move away from anchors)
  refreshCallouts();
  document.getElementById("tView").textContent = v[0].toUpperCase() + v.slice(1);
  // lock is only meaningful in assembled/section
  if (v === "exploded" && state.locked) toggleLock(false);
}

function toggleLock(force) {
  state.locked = force === undefined ? !state.locked : force;
  const b = document.getElementById("lockBtn");
  b.setAttribute("aria-pressed", state.locked);
  b.querySelector(".lbl").textContent = state.locked ? "Mecanum mode" : "Tank drive";
  updateTelemetry();
  if (!state.demo) toast(state.locked ? "Tank drive — rollers locked" : "Mecanum — rollers free");
}

function toggleLabels(force) {
  state.labels = force === undefined ? !state.labels : force;
  document.getElementById("labelBtn").setAttribute("aria-pressed", state.labels);
  refreshCallouts();
}
function refreshCallouts() {
  const show = state.labels && state.view !== "exploded";
  callouts.forEach((o) => o.el.classList.toggle("show", show));
}

function resetAll() {
  toggleLock(false); toggleLabels(true);
  state.sectionAxis = "face"; state.sectionFlip = false;
  document.querySelectorAll(".sc-axis").forEach((b) => b.classList.toggle("active", b.dataset.axis === "face"));
  document.getElementById("flip").checked = false;
  anim.sectionDepth = 0.5; document.getElementById("depth").value = 50;
  setView("assembled");
  animateCamera(camHome.pos, camHome.tgt, 0.9);
}

/* ============================================================
   Demo caption + telemetry copy
   ============================================================ */
let captionEl = null;
function setCaption(text) {
  if (!captionEl) captionEl = document.getElementById("democaption");
  if (!captionEl) return;
  captionEl.querySelector(".cap-body").innerHTML = text;
  captionEl.classList.add("show");
}
function hideCaption() {
  if (!captionEl) captionEl = document.getElementById("democaption");
  if (captionEl) captionEl.classList.remove("show");
}
function updateTelemetry() {
  const chip = document.getElementById("stateChip");
  document.getElementById("tMode").textContent = state.locked ? "Tank drive" : "Mecanum";
  document.getElementById("tRollers").textContent = state.locked ? "Locked · jammed" : "Free · rolling";
  document.getElementById("tMode").style.color = state.locked ? "var(--brand-bright)" : "var(--free)";
  document.getElementById("tRollers").style.color = state.locked ? "var(--brand-bright)" : "var(--free)";
  chip.classList.toggle("locked", state.locked);
  document.getElementById("chipText").textContent = state.locked ? "TANK" : "MECANUM";
}

/* ============================================================
   UI wiring
   ============================================================ */
document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => { stopDemo(); setView(b.dataset.view); }));
document.getElementById("lockBtn").addEventListener("click", () => { stopDemo(); if (state.view === "exploded") setView("assembled"); toggleLock(); });
document.getElementById("labelBtn").addEventListener("click", () => toggleLabels());
document.getElementById("resetBtn").addEventListener("click", () => { stopDemo(); resetAll(); });
document.getElementById("demoBtn").addEventListener("click", () => state.demo ? stopDemo() : startDemo());

document.querySelectorAll(".sc-axis").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".sc-axis").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  state.sectionAxis = b.dataset.axis;
  updateClip();
}));
document.getElementById("depth").addEventListener("input", (e) => { anim.sectionDepth = e.target.value / 100; updateClip(); });
document.getElementById("flip").addEventListener("change", (e) => { state.sectionFlip = e.target.checked; updateClip(); });

addEventListener("keydown", (e) => {
  if (e.key === "l" || e.key === "L") document.getElementById("lockBtn").click();
  else if (e.key === "1") { stopDemo(); setView("assembled"); }
  else if (e.key === "2") { stopDemo(); setView("section"); }
  else if (e.key === "3") { stopDemo(); setView("exploded"); }
});

/* ---------- toast ---------- */
let toastEl = null, toastT = null;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.id = "toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), 1900);
}

/* ============================================================
   Camera tween + intro
   ============================================================ */
let camTween = null;
function animateCamera(toPos, toTgt, dur) {
  camTween = { fromP: camera.position.clone(), toP: toPos.clone(), fromT: controls.target.clone(), toT: toTgt.clone(), t: 0, dur };
}
function introSweep() {
  const from = camera.position.clone().multiplyScalar(1.25);
  camera.position.copy(from);
  animateCamera(camHome.pos, camHome.tgt, 1.4);
}
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/* ============================================================
   Auto demo — narrated, camera-guided tour
   ============================================================ */
let demoTimers = [];
function pose(dx, dy, dz, f, target) {
  const t = (target || WHEEL_CENTER).clone();
  const dir = new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(modelMaxDim * f);
  return { pos: t.clone().add(dir), tgt: t };
}
function moveCam(p, dur) { animateCamera(p.pos, p.tgt, dur); }

function startDemo() {
  state.demo = true;
  state.slowLock = true;
  document.getElementById("demoBtn").querySelector(".lbl").textContent = "Stop tour";

  // reset to a clean starting point
  state.locked && toggleLock(false);
  setView("assembled");
  moveCam(pose(0.32, -0.9, 0.52, 1.85), 1.2);

  const S = [
    [200,  "<b>Locking mecanum drive.</b> One wheel, two completely different modes — watch how it switches.",
           () => moveCam(pose(0.32, -0.9, 0.52, 1.8), 3)],
    [4200, "<b>Mecanum mode.</b> Ten rollers sit at 45°. Each spins freely, so the wheel rolls forward <em>and</em> slips sideways — the robot can strafe in any direction.",
           () => moveCam(pose(0.2, -0.86, 0.45, 1.5), 3.5)],
    [8600, "Now the lock. The <b>servo</b> rotates and slides the <b>actuation shaft</b> straight down the axle.",
           () => { moveCam(pose(0.62, -0.7, 0.4, 1.35), 3); }],
    [11600,"That axial push swings five <b>jamming wedges</b> outward until they clamp every roller.",
           () => toggleLock(true)],
    [16000,"<b>Tank drive.</b> Rollers locked, the wheel now bites like a solid traction wheel — maximum push, zero side-slip.",
           () => moveCam(pose(0.3, -0.85, 0.5, 1.6), 3)],
    [20000,"Let's cut it open to see inside.",
           () => { toggleLock(false); setView("section"); pickAxis("face"); anim.sectionDepth = 0.5; moveCam(pose(0.55, -0.72, 0.4, 1.5), 3); }],
    [23800,"<b>Cross-section.</b> Ten rollers around the outside, five wedges tucked inside the hub.",
           () => {}],
    [26800,"Re-locking — now you can watch the wedges deploy from the inside.",
           () => toggleLock(true)],
    [32000,"Every wedge jams two rollers at once. That's the whole trick.",
           () => moveCam(pose(0.4, -0.8, 0.45, 1.35), 3)],
    [35500,"The other cut — straight down the axle — shows the drivetrain.",
           () => { toggleLock(false); pickAxis("axle"); anim.sectionDepth = 0.5; moveCam(pose(0.25, -0.9, 0.35, 1.6), 3); }],
    [39500,"The <b>8T:96T</b> gears spin the wheel; the servo shaft slides through the hub to throw the lock.",
           () => toggleLock(true)],
    [44500,"And fully exploded — every part laid out along the axle.",
           () => { toggleLock(false); setView("exploded"); moveCam(pose(0.4, -0.85, 0.5, 2.5), 3.5); }],
    [49500,"<b>Mecanum for agility, tank drive for power</b> — switched by a single servo, in one wheel.",
           () => { setView("assembled"); moveCam(pose(0.32, -0.9, 0.52, 1.8), 3); }],
    [54000,"", () => stopDemo()],
  ];
  S.forEach(([t, text, fn]) => demoTimers.push(setTimeout(() => { if (text) setCaption(text); fn(); }, t)));
}
function stopDemo() {
  if (!state.demo && demoTimers.length === 0) return;
  state.demo = false;
  state.slowLock = false;
  demoTimers.forEach(clearTimeout); demoTimers = [];
  hideCaption();
  const b = document.getElementById("demoBtn"); if (b) b.querySelector(".lbl").textContent = "Auto tour";
}
function pickAxis(a) {
  state.sectionAxis = a;
  document.querySelectorAll(".sc-axis").forEach((x) => x.classList.toggle("active", x.dataset.axis === a));
  updateClip();
}

/* ============================================================
   Render loop
   ============================================================ */
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
const freeCol = new THREE.Color(0x22e3a6);
const lockCol = new THREE.Color(0x7b01ac);

function tick(cur, target, rate, dt) { return cur + (target - cur) * Math.min(1, rate * dt); }

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // tween state values
  anim.lock = tick(anim.lock, state.locked ? 1 : 0, state.slowLock ? 1.5 : 7, dt);
  anim.explode = tick(anim.explode, state.view === "exploded" ? 1 : 0, 5, dt);
  anim.sectionAmt = tick(anim.sectionAmt, state.view === "section" ? 1 : 0, 8, dt);

  // LOCK: interpolate every moving part between the unlocked and locked states
  const e = easeInOut(anim.lock);
  for (const n of animatedNodes) {
    n.position.lerpVectors(n.userData.k0.p, n.userData.k1.p, e);
    n.quaternion.slerpQuaternions(n.userData.k0.q, n.userData.k1.q, e);
  }

  // EXPLODE: offset each top-level part (on top of its lock pose)
  for (const g of explodeGroups) {
    if (!g.obj.userData.k0) g.obj.position.copy(g.home); // reset static parts to home
    g.obj.position.addScaledVector(g.offset, anim.explode);
  }

  // roller tint (free = teal, locked = purple)
  const free = 1 - anim.lock;
  rollerMats.forEach((m) => {
    m.emissive.copy(freeCol).lerp(lockCol, anim.lock);
    m.emissiveIntensity = 0.12 + 0.35 * Math.max(anim.lock, 0.25 * free);
  });

  // telemetry live values
  document.getElementById("tServo").textContent = Math.round(e * SERVO_DEG) + "°";
  document.getElementById("tWedge").textContent = (e * WEDGE_MM).toFixed(1) + " mm";

  // camera tween
  if (camTween) {
    camTween.t += dt / camTween.dur;
    const k = easeInOut(Math.min(1, camTween.t));
    camera.position.lerpVectors(camTween.fromP, camTween.toP, k);
    controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
    if (camTween.t >= 1) camTween = null;
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

/* ---------- resize ---------- */
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});
