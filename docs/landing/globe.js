// The coverage globe: the land as a dot matrix, one pulsing marker per country the live catalogue
// covers (coloured by its cheapest price), comet arcs for sales coloured by the network they were
// paid on, and an AI agent on its orbit buying over x402. The arcs and the agent are an
// illustration; the countries and prices are data (globe-data.js).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const D2R = Math.PI / 180;
/** A point on the sphere of radius r at latitude/longitude, east to the right as seen from +z. */
export function ll(lat, lon, r = 1) {
  const phi = (90 - lat) * D2R;
  const th = (lon + 180) * D2R;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}
const priceColor = (usd) => new THREE.Color(usd <= 0.8 ? 0x2bd69b : usd <= 1.5 ? 0x22c7d8 : usd <= 3 ? 0xffcf5a : 0xc3a6ff);

const DOT_VERT = `
  attribute vec3 aColor; attribute float aPhase; attribute float aScale;
  uniform float uSize; uniform float uPR; uniform float uTime;
  varying vec3 vColor; varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize((modelViewMatrix * vec4(position, 0.0)).xyz);
    vFade = smoothstep(-0.1, 0.45, dot(n, normalize(-mv.xyz)));
    float pulse = aPhase > 0.0 ? 1.0 + 0.32 * sin(uTime * 2.1 + aPhase) : 1.0;
    gl_PointSize = uSize * aScale * uPR * pulse * (4.0 / -mv.z);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;
const DOT_FRAG = `
  uniform float uOpacity; uniform float uCore;
  varying vec3 vColor; varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = mix(smoothstep(0.5, 0.0, d), step(d, 0.32), uCore);
    gl_FragColor = vec4(vColor, a * vFade * uOpacity);
  }`;

export function startGlobe({ canvas, land, countries, networks, reduced = false, onHover = () => {}, onPick = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  const PR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const BASE = 4.75;
  camera.position.copy(ll(24, 22, BASE));            // Europe, Africa and the Middle East first

  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableZoom: false, enablePan: false, enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.55,
                            autoRotate: !reduced, autoRotateSpeed: 0.42, minPolarAngle: 0.22 * Math.PI, maxPolarAngle: 0.78 * Math.PI });

  const world = new THREE.Group();
  scene.add(world);

  // Ocean, a rim of light on its edge, and the atmosphere around it.
  world.add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 96, 96), new THREE.MeshBasicMaterial({ color: 0x05121a })));
  const fresnel = (power, strength, side, color) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; void main(){ float i = pow(${side === THREE.BackSide ? "0.66 - dot(vN, vec3(0.0, 0.0, 1.0))" : "1.0 - abs(dot(vN, vec3(0.0, 0.0, 1.0)))"}, ${power.toFixed(1)}) * ${strength.toFixed(2)}; gl_FragColor = vec4(uColor * i, i); }`,
    side, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  world.add(new THREE.Mesh(new THREE.SphereGeometry(1.0, 96, 96), fresnel(3.0, 0.55, THREE.FrontSide, 0x2bd69b)));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.17, 96, 96), fresnel(3.2, 1.25, THREE.BackSide, 0x22c7d8)));

  // A faint graticule every 30°.
  const grat = new THREE.Group();
  const gratMat = new THREE.LineBasicMaterial({ color: 0x2bd69b, transparent: true, opacity: 0.06, depthWrite: false });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = []; for (let lon = -180; lon <= 180; lon += 3) pts.push(ll(lat, lon, 1.001));
    grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = []; for (let lat = -90; lat <= 90; lat += 3) pts.push(ll(lat, lon, 1.001));
    grat.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
  }
  world.add(grat);

  const dots = (positions, colors, phases, scales, { size, opacity, core }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
    g.setAttribute("aScale", new THREE.Float32BufferAttribute(scales, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size }, uPR: { value: PR }, uTime: { value: 0 }, uOpacity: { value: opacity }, uCore: { value: core } },
      vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return new THREE.Points(g, m);
  };

  // The land.
  {
    const pos = [], col = [], ph = [], sc = [];
    const c = new THREE.Color(0x52d6b4);
    for (let i = 0; i < land.length; i += 2) {
      const v = ll(land[i], land[i + 1], 1.003);
      pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); ph.push(0); sc.push(1);
    }
    world.add(dots(pos, col, ph, sc, { size: 2.7, opacity: 0.78, core: 1 }));
  }

  // The countries: a glow and a bright core each, pulsing out of step.
  const markerPos = countries.map(([, lat, lon]) => ll(lat, lon, 1.008));
  const glowPos = [], glowCol = [], glowPh = [], glowSc = [];
  countries.forEach(([, , , from, local], i) => {
    const v = markerPos[i], c = priceColor(from);
    glowPos.push(v.x, v.y, v.z); glowCol.push(c.r, c.g, c.b); glowPh.push(1 + ((i * 2.399) % 6.28)); glowSc.push(1 + Math.min(local || 0, 20) / 22);
  });
  const glow = dots(glowPos, glowCol, glowPh, glowSc, { size: 12, opacity: 0.42, core: 0 });
  const cores = dots(glowPos, glowCol.map((x) => Math.min(1, x * 0.6 + 0.45)), glowPh.map(() => 0), glowSc, { size: 4, opacity: 1, core: 1 });
  world.add(glow, cores);

  // Stars.
  {
    const pos = [], col = [], ph = [], sc = [];
    for (let i = 0; i < 1400; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 40);
      const b = 0.4 + Math.random() * 0.6;
      pos.push(v.x, v.y, v.z); col.push(0.75 * b, 0.9 * b, b); ph.push(0); sc.push(0.6 + Math.random());
    }
    scene.add(dots(pos, col, ph, sc, { size: 1.6, opacity: 0.8, core: 0 }));
  }

  // Sales: comet arcs between covered countries, in the colour of the network that paid.
  const netPick = (() => {
    const total = networks.reduce((s, n) => s + n.weight, 0);
    return () => { let r = Math.random() * total; for (const n of networks) { if ((r -= n.weight) <= 0) return n; } return networks[0]; };
  })();
  const ARC_VERT = "attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  const ARC_FRAG = `uniform float uHead; uniform float uAlpha; uniform vec3 uColor; varying float vT;
    void main(){ if (vT > uHead) discard; float tail = smoothstep(uHead - 0.5, uHead, vT); gl_FragColor = vec4(uColor * 1.35, (0.1 + 0.9 * tail) * uAlpha); }`;
  const ringGeo = new THREE.RingGeometry(0.012, 0.02, 40);
  const live = [];
  function ring(at, color) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
                                                                    blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(at).multiplyScalar(1.004);
    m.lookAt(at.clone().multiplyScalar(2));
    world.add(m);
    live.push({ kind: "ring", obj: m, age: 0, life: 1.4 });
  }
  function arc() {
    let a, b, guard = 0;
    do {
      a = Math.floor(Math.random() * countries.length); b = Math.floor(Math.random() * countries.length);
    } while ((a === b || markerPos[a].angleTo(markerPos[b]) < 0.35) && ++guard < 20);
    const va = markerPos[a].clone().normalize(), vb = markerPos[b].clone().normalize();
    const ang = va.angleTo(vb), lift = 0.06 + 0.32 * (ang / Math.PI);
    const N = 80, pts = [], ts = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const p = new THREE.Vector3().copy(va).multiplyScalar(Math.sin((1 - s) * ang) / Math.sin(ang))
        .add(vb.clone().multiplyScalar(Math.sin(s * ang) / Math.sin(ang)));
      pts.push(p.multiplyScalar(1.01 + lift * Math.sin(Math.PI * s))); ts.push(s);
    }
    const net = netPick();
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    g.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { uHead: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(net.color) } },
      vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(g, m);
    // The comet's head: one bright point that runs along the arc.
    const head = dots([0, 0, 0], [...new THREE.Color(net.color).lerp(new THREE.Color(0xffffff), 0.35).toArray()], [0], [1], { size: 13, opacity: 1, core: 0 });
    line.add(head);
    world.add(line);
    live.push({ kind: "arc", obj: line, head, pts, age: 0, travel: 1.5 + ang * 0.6, life: 1.5 + ang * 0.6 + 1.1, to: markerPos[b], color: net.color, landed: false });
  }

  // The agent: a satellite on an inclined orbit, its trail, and a beam each time it buys.
  const agent = new THREE.Group();
  const orbitTilt = new THREE.Euler(0.42, 0, -0.28);
  const sat = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 16), new THREE.MeshBasicMaterial({ color: 0xeafff7 }));
  const satGlow = dots([0, 0, 0], [0.5, 0.95, 0.85], [1], [1], { size: 26, opacity: 0.9, core: 0 });
  sat.add(satGlow);
  agent.add(sat);
  const TRAIL = 90;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailT = new Float32Array(TRAIL).map((_, i) => i / (TRAIL - 1));
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("aT", new THREE.BufferAttribute(trailT, 1));
  const trail = new THREE.Line(trailGeo, new THREE.ShaderMaterial({ uniforms: { uHead: { value: 1 }, uAlpha: { value: 0.7 }, uColor: { value: new THREE.Color(0x7fe9d6) } },
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(agent, trail);
  let orbit = Math.random() * Math.PI * 2;
  const satAt = (a) => new THREE.Vector3(Math.cos(a) * 1.52, 0, Math.sin(a) * 1.52).applyEuler(orbitTilt);
  for (let i = 0; i < TRAIL; i++) { const p = satAt(orbit - (TRAIL - i) * 0.012); trailPos.set([p.x, p.y, p.z], i * 3); }
  const base = networks.find((n) => n.name === "Base")?.color || "#3b6cff";
  function beam() {
    const from = sat.position.clone();
    const facing = markerPos.filter((p) => p.clone().normalize().dot(from.clone().normalize()) > 0.55);
    if (!facing.length) return;
    const to = facing[Math.floor(Math.random() * facing.length)];
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    g.setAttribute("aT", new THREE.Float32BufferAttribute([0, 1], 1));
    const line = new THREE.Line(g, new THREE.ShaderMaterial({ uniforms: { uHead: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(base) } },
      vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(line);
    live.push({ kind: "beam", obj: line, age: 0, travel: 0.45, life: 1.2, to, color: base, landed: false });
  }

  // Size, hover and click.
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.setLength(BASE / Math.min(1, camera.aspect / 0.92));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const ray = new THREE.Raycaster();
  ray.params.Points.threshold = 0.04;
  const mouse = new THREE.Vector2();
  let hovered = null, downAt = null;
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const eye = camera.position.clone().normalize();
    const hits = ray.intersectObject(cores).filter((h) => markerPos[h.index].clone().normalize().dot(eye) > 0.12);
    hits.sort((a, b) => a.distanceToRay - b.distanceToRay);
    return hits.length ? countries[hits[0].index] : null;
  }
  canvas.addEventListener("pointermove", (ev) => {
    if (ev.buttons) { onHover(null); return; }
    hovered = pick(ev);
    canvas.style.cursor = hovered ? "pointer" : "grab";
    onHover(hovered, ev.clientX, ev.clientY);
    controls.autoRotate = !reduced && !hovered;
  });
  canvas.addEventListener("pointerleave", () => { hovered = null; onHover(null); controls.autoRotate = !reduced; });
  canvas.addEventListener("pointerdown", (ev) => { downAt = [ev.clientX, ev.clientY]; });
  canvas.addEventListener("pointerup", (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5) return;
    const c = pick(ev);
    if (c) onPick(c);
  });

  // The loop: paused while the globe is off screen or the tab is hidden.
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const clock = new THREE.Clock();
  let nextArc = 0, nextBeam = 2.5, time = 0;
  const materials = [glow.material, cores.material, satGlow.material];
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible || document.hidden) return;
    time += dt;
    for (const m of materials) m.uniforms.uTime.value = time;

    if (!reduced) {
      if ((nextArc -= dt) <= 0 && live.filter((x) => x.kind === "arc").length < 14) { arc(); nextArc = 0.35 + Math.random() * 0.55; }
      orbit += dt * 0.32;
      sat.position.copy(satAt(orbit));
      trailPos.copyWithin(0, 3);
      trailPos.set([sat.position.x, sat.position.y, sat.position.z], (TRAIL - 1) * 3);
      trailGeo.attributes.position.needsUpdate = true;
      if ((nextBeam -= dt) <= 0) { beam(); nextBeam = 2.6 + Math.random() * 1.8; }
    } else if (!sat.position.lengthSq()) {
      sat.position.copy(satAt(orbit));
    }

    for (let i = live.length - 1; i >= 0; i--) {
      const x = live[i];
      x.age += dt;
      if (x.kind === "ring") {
        const k = x.age / x.life;
        x.obj.scale.setScalar(1 + k * 5);
        x.obj.material.opacity = 0.9 * (1 - k);
      } else {
        const u = x.obj.material.uniforms;
        u.uHead.value = Math.min(1.5, x.age / x.travel);
        if (x.head) {
          const k = Math.min(1, x.age / x.travel);
          x.head.position.copy(x.pts[Math.round(k * (x.pts.length - 1))]);
          x.head.material.uniforms.uOpacity.value = k < 1 ? 1 : 0;
        }
        if (!x.landed && x.age >= x.travel) { x.landed = true; ring(x.to, x.color); }
        u.uAlpha.value = x.age > x.travel ? Math.max(0, 1 - (x.age - x.travel) / (x.life - x.travel)) : 1;
        if (x.head) x.head.material.uniforms.uTime.value = time;
      }
      if (x.age >= x.life) {
        x.obj.parent.remove(x.obj);
        if (x.kind !== "ring") x.obj.geometry.dispose();
        x.obj.material.dispose();
        if (x.head) { x.head.geometry.dispose(); x.head.material.dispose(); }
        live.splice(i, 1);
      }
    }
    controls.update();
    renderer.render(scene, camera);
  });
  return { renderer, scene, camera };
}
