import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* ============================================================
   Locking Mecanum — interactive module viewer
   ============================================================ */

// Model file candidates (works whether committed with spaces or renamed).
const MODEL_CANDIDATES = [
  "Left Slant Module.glb",
  "Left_Slant_Module__1_.glb",
  "model.glb",
  "https://raw.githubusercontent.com/liamtaymourdavidson-create/locking-mecanum-demo/main/Left%20Slant%20Module.glb",
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

const SLIDER_TRAVEL = 0.0042; // m the wedges push outward when locking
const WHEEL_CENTER = new THREE.Vector3(...PART.wheelCenter);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
camera.position.set(0.17, 0.11, 0.22);

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
let sectionPlaneMesh = null;

/* ---------- state ---------- */
const state = {
  view: "assembled", // assembled | section | exploded
  locked: false,
  labels: true,
  spin: false,
  sectionAxis: "face", // face (perp to axle) | axle (through axle)
  sectionFlip: false,
  demo: false,
};
// animated (tweened) values
const anim = { lock: 0, explode: 0, sectionAmt: 0, sectionDepth: 0.5, spinVel: 0 };

let model = null;
let wheelSpin = null;
const sliderPivots = [];
const rollerPivots = [];
const rollerMats = [];
const explodeGroups = []; // {obj, home:Vector3, offset:Vector3}
const callouts = [];
let modelBox = new THREE.Box3();

/* ============================================================
   Load
   ============================================================ */
const loaderEl = document.getElementById("loader");
const pctEl = document.getElementById("loadPct");
const gltfLoader = new GLTFLoader();

loadFirst(0);
function loadFirst(i) {
  if (i >= MODEL_CANDIDATES.length) return fail("Checked all known filenames.");
  gltfLoader.load(
    MODEL_CANDIDATES[i],
    (gltf) => onLoaded(gltf),
    (xhr) => { if (xhr.total) pctEl.textContent = Math.round((xhr.loaded / xhr.total) * 100) + "%"; },
    () => loadFirst(i + 1)
  );
}
function fail(msg) {
  loaderEl.classList.add("hide");
  const e = document.getElementById("errbox");
  e.hidden = false;
  document.getElementById("errmsg").textContent = " " + msg + " Make sure the .glb sits next to index.html.";
}

function onLoaded(gltf) {
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

  buildWheelAndRollers();
  buildSliders();
  frameModel();
  buildExplodeGroups();
  buildCallouts();
  buildSectionPlaneMesh();

  loaderEl.classList.add("hide");
  setView("assembled");
  updateTelemetry();
  if (!reduceMotion) introSweep();
}

/* ---------- wheel spin group + per-roller pivots ---------- */
function buildWheelAndRollers() {
  wheelSpin = new THREE.Group();
  wheelSpin.name = "__wheelSpin";
  model.add(wheelSpin);

  // move the whole mecanum wheel node under the spin group
  let wheelNode = null;
  model.traverse((o) => { if (!wheelNode && /Mecanum Wheel/i.test(o.name)) wheelNode = o; });
  if (wheelNode) wheelSpin.attach(wheelNode);

  // roller pivots
  PART.rollers.forEach((r) => {
    const p = new THREE.Group();
    p.position.set(...r.center);
    p.userData.axis = new THREE.Vector3(...r.axis).normalize();
    wheelSpin.add(p);
    rollerPivots.push(p);
  });

  // attach each roller mesh to nearest pivot; collect a material to tint
  const tmp = new THREE.Vector3();
  const rollerMeshes = [];
  model.traverse((o) => {
    if (o.isMesh && /roller/i.test(o.name) && !/side plate/i.test(o.name)) rollerMeshes.push(o);
  });
  rollerMeshes.forEach((mesh) => {
    mesh.getWorldPosition(tmp);
    let best = 0, bd = Infinity;
    rollerPivots.forEach((p, i) => { const d = p.position.distanceTo(tmp); if (d < bd) { bd = d; best = i; } });
    rollerPivots[best].attach(mesh);
    if (/roller core/i.test(mesh.name)) {
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const c = m.clone();
      c.emissive = new THREE.Color(0x000000);
      mesh.material = c;
      if (!rollerMats.includes(c)) rollerMats.push(c);
      if (!allMaterials.includes(c)) allMaterials.push(c);
    }
  });
}

/* ---------- slider (jamming wedge) pivots ---------- */
function buildSliders() {
  const sliders = [], joints = [];
  model.traverse((o) => {
    if (o.name === "Slider") sliders.push(o);
    else if (o.name === "Joint") joints.push(o);
  });
  const tmp = new THREE.Vector3();
  const nearest = (arr, target) => {
    let best = null, bd = Infinity;
    arr.forEach((o) => { o.getWorldPosition(tmp); const d = tmp.distanceTo(target); if (d < bd) { bd = d; best = o; } });
    return best;
  };
  PART.sliders.forEach((s) => {
    const c = new THREE.Vector3(...s.center);
    const pivot = new THREE.Group();
    pivot.userData.radial = new THREE.Vector3(...s.radial).normalize();
    pivot.userData.home = new THREE.Vector3(0, 0, 0);
    model.add(pivot);
    const sl = nearest(sliders, c); if (sl) pivot.attach(sl);
    const jo = nearest(joints, c); if (jo) pivot.attach(jo);
    sliderPivots.push(pivot);
  });
}

/* ---------- camera framing ---------- */
function frameModel() {
  modelBox.setFromObject(model);
  const size = modelBox.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z);
  const dist = maxd * 1.75;
  const dir = new THREE.Vector3(0.55, 0.42, 0.9).normalize();
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
  model.children.forEach((child) => {
    if (child.type === "AmbientLight") return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    box.getCenter(c);
    const name = child.name || "";
    const radial = new THREE.Vector3(0, c.y - wc.y, c.z - wc.z);
    if (radial.lengthSq() < 1e-9) radial.set(0, 1, 0);
    radial.normalize();
    const dx = c.x - wc.x;
    let off = new THREE.Vector3();

    if (child === wheelSpin) {
      off.set(0, 0, 0); // wheel stays as the anchor
    } else if (/Motor|Servo|Mata/i.test(name)) {
      off.set(0.13, 0, 0).addScaledVector(radial, 0.02);
    } else if (/Actuation Shaft/i.test(name)) {
      off.set(0.075, 0, 0);
    } else if (/Gear|96t/i.test(name)) {
      off.set(0.05, 0, 0);
    } else if (/Inner (Plate|Core)/i.test(name)) {
      off.set(0.035, 0, 0);
    } else if (/Outer (Plate|Core)/i.test(name)) {
      off.set(-0.045, 0, 0);
    } else if (/Square Beam/i.test(name)) {
      off.copy(radial).multiplyScalar(0.06).setX(dx * 0.2); // open the cage
    } else if (/Button|Socket|Nut|Locknut|Bearing|spacer|Thrust|e-clip|Screw/i.test(name)) {
      off.copy(radial).multiplyScalar(0.055); off.x += dx > 0 ? 0.03 : -0.02; // scatter fasteners
    } else if (sliderPivots.includes(child)) {
      child.userData.exOffset = new THREE.Vector3(0.024, 0, 0); // handled in slider loop
      return;
    } else {
      off.copy(radial).multiplyScalar(0.03); off.x += dx * 0.4;
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
    { p: PART.rollers[7].center, t: "Mecanum roller ×10", s: "free-spin @45°", c: "free" },
    { p: PART.sliders[1].center, t: "Jamming wedge ×5", s: "the lock", c: "" },
    { p: PART.keyParts.shaft, t: "Actuation shaft", s: "drives the wedges", c: "" },
    { p: PART.keyParts.gear96, t: "96T hub gear", s: "wheel drive", c: "gold" },
    { p: PART.keyParts.servo, t: "Lock servo", s: "", c: "" },
    { p: PART.keyParts.motor, t: "6000 rpm motor", s: "traction drive", c: "" },
    { p: [0.008, 0.05, 0.012], t: "Slant side plate", s: "3606-0000-0096", c: "" },
  ];
  defs.forEach((d) => {
    const o = makeTag(d.t, d.s, d.c);
    o.position.set(...d.p);
    scene.add(o);
    callouts.push(o);
  });
}

/* ---------- section plane visual ---------- */
function buildSectionPlaneMesh() {
  const s = modelBox.getSize(new THREE.Vector3());
  const dim = Math.max(s.x, s.y, s.z) * 1.15;
  const g = new THREE.PlaneGeometry(dim, dim);
  const m = new THREE.MeshBasicMaterial({
    color: 0x7b01ac, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
    depthWrite: false, clippingPlanes: [],
  });
  sectionPlaneMesh = new THREE.Mesh(g, m);
  sectionPlaneMesh.visible = false;
  scene.add(sectionPlaneMesh);
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
  // Cut range centred on the wheel (the motor sticking out would skew a bbox-based range).
  let centerAlong, half;
  if (state.sectionAxis === "face") { centerAlong = PART.wheelCenter[0]; half = 0.033; }   // slice across the axle
  else { centerAlong = 0; half = s.z * 0.5; }                                               // slice down the axle
  const along = centerAlong - half + anim.sectionDepth * 2 * half; // 0..1 sweeps the plane
  clipPlane.normal.copy(n);
  clipPlane.constant = -n.dot(new THREE.Vector3().copy(sectionAxisVec()).multiplyScalar(along));
  if (sectionPlaneMesh) {
    sectionPlaneMesh.position.copy(sectionAxisVec()).multiplyScalar(along);
    sectionPlaneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }
}
function sectionAxisVec() {
  return state.sectionAxis === "face" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
}
function setSectionMaterials(on) {
  allMaterials.forEach((m) => { m.clippingPlanes = on ? [clipPlane] : []; m.needsUpdate = false; });
  if (sectionPlaneMesh) sectionPlaneMesh.visible = on;
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
  updateExplainer();
}

function toggleLock(force) {
  state.locked = force === undefined ? !state.locked : force;
  const b = document.getElementById("lockBtn");
  b.setAttribute("aria-pressed", state.locked);
  b.querySelector(".lbl").textContent = state.locked ? "Unlock rollers" : "Lock rollers";
  updateExplainer();
  updateTelemetry();
  toast(state.locked ? "Rollers locked — traction drive" : "Rollers free — omnidirectional");
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

function toggleSpin(force) {
  state.spin = force === undefined ? !state.spin : force;
  document.getElementById("spinBtn").setAttribute("aria-pressed", state.spin);
}

function resetAll() {
  toggleLock(false); toggleLabels(true); toggleSpin(false);
  state.sectionAxis = "face"; state.sectionFlip = false;
  document.querySelectorAll(".sc-axis").forEach((b) => b.classList.toggle("active", b.dataset.axis === "face"));
  document.getElementById("flip").checked = false;
  anim.sectionDepth = 0.5; document.getElementById("depth").value = 50;
  setView("assembled");
  animateCamera(camHome.pos, camHome.tgt, 0.9);
}

/* ============================================================
   Explainer + telemetry copy
   ============================================================ */
function updateExplainer() {
  const T = document.getElementById("expTitle");
  const B = document.getElementById("expBody");
  const tab = document.querySelector(".exp-tab");
  if (state.view === "section") {
    tab.textContent = "SECTION";
    if (state.sectionAxis === "face") {
      T.textContent = "Face section";
      B.innerHTML = "Cutting across the axle exposes the ring: <b>ten rollers</b> outside, " +
        "<b>five wedges</b> inside. Locked, each wedge jams against two rollers so none can spin.";
    } else {
      T.textContent = "Axle section";
      B.innerHTML = "Cutting down the axle shows the drive train: motor → <b>96T hub gear</b> spins the wheel, " +
        "while the <b>servo</b> turns the <b>actuation shaft</b> that pushes every wedge out at once.";
    }
    return;
  }
  if (state.view === "exploded") {
    tab.textContent = "ASSEMBLY";
    T.textContent = "Exploded view";
    B.innerHTML = "Left to right along the axle: outer plate, hub core and wheel, inner plate, the gear " +
      "stack, actuation shaft, then the servo and drive motor bolted to the beam frame.";
    return;
  }
  tab.textContent = "HOW IT WORKS";
  if (state.locked) {
    T.textContent = "Traction mode";
    B.innerHTML = "The servo drove the wedges outward and <b>jammed the rollers</b>. They can't spin now, " +
      "so the wheel bites like a normal traction wheel — max push, no sideways slip.";
  } else {
    T.textContent = "Omnidirectional mode";
    B.innerHTML = "Ten rollers sit at 45° around the rim. Each spins freely on its own axle, so the wheel rolls " +
      "forward <em>and</em> slips sideways — that's how a mecanum robot <em>strafes</em>. Hit <b>Lock rollers</b>.";
  }
}
function updateTelemetry() {
  const chip = document.getElementById("stateChip");
  document.getElementById("tMode").textContent = state.locked ? "Traction" : "Omnidirectional";
  document.getElementById("tRollers").textContent = state.locked ? "Locked · jammed" : "Free · rolling";
  document.getElementById("tMode").style.color = state.locked ? "var(--brand-bright)" : "var(--free)";
  document.getElementById("tRollers").style.color = state.locked ? "var(--brand-bright)" : "var(--free)";
  chip.classList.toggle("locked", state.locked);
  document.getElementById("chipText").textContent = state.locked ? "LOCKED" : "FREE";
}

/* ============================================================
   UI wiring
   ============================================================ */
document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => { stopDemo(); setView(b.dataset.view); }));
document.getElementById("lockBtn").addEventListener("click", () => { stopDemo(); if (state.view === "exploded") setView("assembled"); toggleLock(); });
document.getElementById("labelBtn").addEventListener("click", () => toggleLabels());
document.getElementById("spinBtn").addEventListener("click", () => toggleSpin());
document.getElementById("resetBtn").addEventListener("click", () => { stopDemo(); resetAll(); });
document.getElementById("demoBtn").addEventListener("click", () => state.demo ? stopDemo() : startDemo());

document.querySelectorAll(".sc-axis").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".sc-axis").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  state.sectionAxis = b.dataset.axis;
  updateClip(); updateExplainer();
}));
document.getElementById("depth").addEventListener("input", (e) => { anim.sectionDepth = e.target.value / 100; updateClip(); });
document.getElementById("flip").addEventListener("change", (e) => { state.sectionFlip = e.target.checked; updateClip(); });
document.getElementById("helpToggle").addEventListener("click", () => document.body.classList.toggle("info-collapsed"));

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
   Auto demo
   ============================================================ */
let demoTimers = [];
function startDemo() {
  state.demo = true;
  document.getElementById("demoBtn").querySelector(".lbl").textContent = "Stop";
  const seq = [
    [0, () => { resetSilent(); setView("assembled"); toast("Omnidirectional — rollers free"); }],
    [2600, () => { setView("assembled"); toggleLock(true); }],
    [5200, () => { toggleLock(false); }],
    [7200, () => { setView("section"); pickAxis("face"); toast("Face section"); }],
    [8200, () => sweepDepth()],
    [12000, () => { pickAxis("axle"); toast("Axle section"); }],
    [15000, () => { setView("exploded"); }],
    [18500, () => { setView("assembled"); }],
    [20000, () => { stopDemo(); }],
  ];
  seq.forEach(([t, fn]) => demoTimers.push(setTimeout(fn, t)));
}
function stopDemo() {
  if (!state.demo && demoTimers.length === 0) return;
  state.demo = false;
  demoTimers.forEach(clearTimeout); demoTimers = [];
  const b = document.getElementById("demoBtn"); if (b) b.querySelector(".lbl").textContent = "Auto demo";
}
function resetSilent() { state.locked && toggleLock(false); }
function pickAxis(a) {
  state.sectionAxis = a;
  document.querySelectorAll(".sc-axis").forEach((x) => x.classList.toggle("active", x.dataset.axis === a));
  updateClip(); updateExplainer();
}
let depthSweep = null;
function sweepDepth() { depthSweep = { t: 0 }; }

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
  anim.lock = tick(anim.lock, state.locked ? 1 : 0, 7, dt);
  anim.explode = tick(anim.explode, state.view === "exploded" ? 1 : 0, 5, dt);
  anim.sectionAmt = tick(anim.sectionAmt, state.view === "section" ? 1 : 0, 8, dt);

  // depth sweep during demo
  if (depthSweep) {
    depthSweep.t += dt / 3.2;
    anim.sectionDepth = 0.5 + 0.42 * Math.sin(depthSweep.t * Math.PI * 2);
    document.getElementById("depth").value = Math.round(anim.sectionDepth * 100);
    updateClip();
    if (depthSweep.t >= 1) depthSweep = null;
  }

  // sliders push out with lock (and drift out in the exploded view)
  const travel = SLIDER_TRAVEL * easeInOut(anim.lock);
  sliderPivots.forEach((p) => {
    tmpV.copy(p.userData.radial).multiplyScalar(travel).add(p.userData.home);
    if (p.userData.exOffset) tmpV.addScaledVector(p.userData.exOffset, anim.explode);
    p.position.copy(tmpV);
  });

  // explode positions
  explodeGroups.forEach((g) => {
    g.obj.position.copy(g.home).addScaledVector(g.offset, anim.explode);
  });

  // roller idle spin when free (+ optional wheel spin)
  const free = 1 - anim.lock;
  if (!reduceMotion && state.view !== "exploded") {
    const rate = free * 2.6 * dt;
    if (rate > 0.0001) rollerPivots.forEach((p) => p.rotateOnAxis(p.userData.axis, rate));
  }
  anim.spinVel = tick(anim.spinVel, state.spin ? 1 : 0, 3, dt);
  if (wheelSpin && anim.spinVel > 0.001) wheelSpin.rotateOnWorldAxis(AXIS_X, anim.spinVel * 0.9 * dt);

  // roller tint (free = teal, locked = purple)
  rollerMats.forEach((m) => {
    m.emissive.copy(freeCol).lerp(lockCol, anim.lock);
    m.emissiveIntensity = 0.12 + 0.35 * Math.max(anim.lock, 0.25 * free);
  });

  // telemetry live values
  document.getElementById("tServo").textContent = Math.round(anim.lock * 62) + "°";
  document.getElementById("tWedge").textContent = (easeInOut(anim.lock) * SLIDER_TRAVEL * 1000).toFixed(1) + " mm";

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
