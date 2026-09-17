"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// ---------------------------------------------------------------------------
// 100x Market Radar — the intro stage, in real 3D.
// A radar sweep on a dark floor; the S&P 500 stands as a luminous ridge wall
// with the Nasdaq behind it; the eleven sectors rise as glowing pillars on an
// arc; the sector-rotation map floats as a tilted glass quadrant with spheres
// dropping onto their real coordinates. Bloom, fog, drifting particles.
// Pointer parallax always; drag orbits; hover a pillar or sphere for its value.
// Colors come from the intro-* CSS tokens so the palette has one source.
// ---------------------------------------------------------------------------

export interface SceneSeries {
  values: number[];
  price: number;
  changePercent: number;
}

export interface SceneSector {
  symbol: string;
  name: string;
  changePercent: number;
}

export interface SceneDot {
  symbol: string;
  name: string;
  relative: number;
  band: number;
}

export interface IntroSceneProps {
  sp: SceneSeries | null;
  nq: SceneSeries | null;
  sectors: SceneSector[];
  dots: SceneDot[];
  narrow: boolean;
  /** Called once the first frame has rendered. */
  onReady?: () => void;
  /** Hovered label text (name + value) or null. */
  onHover?: (label: string | null) => void;
}

type Label = { el: HTMLDivElement; anchor: THREE.Object3D; offsetY: number };

/** Reads an intro-* token from the CSS; the numeric fallback only guards a missing stylesheet. */
function cssColorFrom(el: Element, name: string, fallback: number): THREE.Color {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  return raw ? new THREE.Color(raw) : new THREE.Color(fallback);
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function norm(values: number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  return values.map((v) => (v - lo) / span);
}

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
}

function fmtPp(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%p`;
}

/** A wall whose top edge follows the series; vertex y carries 0..1 height for the shader. */
function ridgeGeometry(values: number[], length: number, height: number): THREE.BufferGeometry {
  const n = values.length;
  const pos: number[] = [];
  const hgt: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = -length / 2 + (length * i) / (n - 1);
    const y = values[i] * height;
    pos.push(x, 0, 0, x, y, 0);
    hgt.push(0, values[i]);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("h", new THREE.Float32BufferAttribute(hgt, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function ridgeMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uGrow: { value: 0 } },
    vertexShader: `
      attribute float h;
      varying float vH;
      uniform float uGrow;
      void main() {
        vH = h;
        vec3 p = position;
        p.y *= uGrow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vH;
      void main() {
        float a = smoothstep(0.0, 1.0, vH) * 0.55;
        gl_FragColor = vec4(uColor * (0.35 + 0.65 * vH), a);
      }`,
  });
}

function sweepMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float ang = atan(c.y, c.x);
        float sweep = fract((ang / 6.28318) - uTime * 0.12);
        float trail = pow(1.0 - sweep, 6.0);
        float rings = smoothstep(0.985, 1.0, fract(r * 6.0)) * 0.25;
        float edge = 1.0 - smoothstep(0.75, 1.0, r);
        float a = (trail * 0.35 + rings) * edge * (0.25 + 0.75 * (1.0 - r));
        gl_FragColor = vec4(uColor, a);
      }`,
  });
}

export default function IntroScene({ sp, nq, sectors, dots, narrow, onReady, onHover }: IntroSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  const onHoverRef = useRef(onHover);
  onReadyRef.current = onReady;
  onHoverRef.current = onHover;

  useEffect(() => {
    const host = hostRef.current;
    const labelsHost = labelsRef.current;
    if (!host || !labelsHost) return;
    if (!sp && !nq && !sectors.length && !dots.length) return;

    // --- palette from tokens (one source of truth with the CSS) ---
    const root = host.closest(".intro-root") ?? document.documentElement;
    const cBg = cssColorFrom(root, "--intro-bg", 0x08090a);
    const cBrand = cssColorFrom(root, "--intro-brand", 0x3b8de8);
    const cInk = cssColorFrom(root, "--intro-ink-3", 0x7c8594);
    const cUp = cssColorFrom(root, "--intro-up", 0x34c48b);
    const cDown = cssColorFrom(root, "--intro-down", 0xf0566e);

    // --- renderer / scene / camera ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.25 : 1.35));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = cBg;
    scene.fog = new THREE.FogExp2(cBg.getHex(), narrow ? 0.03 : 0.024);

    const camera = new THREE.PerspectiveCamera(narrow ? 52 : 42, host.clientWidth / host.clientHeight, 0.1, 200);
    const camFrom = narrow ? new THREE.Vector3(0, 18, 30) : new THREE.Vector3(2, 16, 34);
    const camTo = narrow ? new THREE.Vector3(-1.5, 6.5, 17) : new THREE.Vector3(-7.5, 5.2, 15.5);
    const lookAt = narrow ? new THREE.Vector3(0.5, 1.6, 0) : new THREE.Vector3(1.5, 1.4, 0);
    camera.position.copy(camFrom);
    camera.lookAt(lookAt);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(Math.ceil(host.clientWidth / 2), Math.ceil(host.clientHeight / 2)), 0.85, 0.65, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // --- lights ---
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(-8, 14, 10);
    scene.add(key);
    const rim = new THREE.PointLight(cBrand.getHex(), 40, 60, 2);
    rim.position.set(6, 6, -8);
    scene.add(rim);

    // --- floor: fine grid + radar sweep ---
    const grid = new THREE.GridHelper(80, 80, cBrand.getHex(), cBrand.getHex());
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.08;
    grid.position.y = -0.01;
    scene.add(grid);
    const sweepMat = sweepMaterial(cBrand);
    const sweep = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), sweepMat);
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.set(0, 0.005, -2);
    scene.add(sweep);

    // --- ridges: S&P wall + top line, Nasdaq behind ---
    const disposables: { dispose: () => void }[] = [sweepMat, grid.geometry, grid.material as THREE.Material];
    const ridgeMats: THREE.ShaderMaterial[] = [];
    const ridgeLength = narrow ? 18 : 26;
    const makeRidge = (series: SceneSeries, z: number, height: number, color: THREE.Color, lineRadius: number) => {
      const v = norm(series.values);
      const geo = ridgeGeometry(v, ridgeLength, height);
      const mat = ridgeMaterial(color);
      ridgeMats.push(mat);
      const wall = new THREE.Mesh(geo, mat);
      wall.position.set(0, 0, z);
      scene.add(wall);
      const pts = v.map((y, i) => new THREE.Vector3(-ridgeLength / 2 + (ridgeLength * i) / (v.length - 1), y * height, z));
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.4);
      const tubeGeo = new THREE.TubeGeometry(curve, v.length * 4, lineRadius, 6, false);
      const tubeMat = new THREE.MeshBasicMaterial({ color });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      tube.scale.y = 0.0001;
      scene.add(tube);
      const head = new THREE.Mesh(new THREE.SphereGeometry(lineRadius * 2.6, 16, 12), new THREE.MeshBasicMaterial({ color }));
      head.position.copy(pts[pts.length - 1]);
      head.visible = false;
      scene.add(head);
      disposables.push(geo, mat, tubeGeo, tubeMat, head.geometry, head.material as THREE.Material);
      return { wall, tube, head, top: pts[pts.length - 1] };
    };
    const spRidge = sp ? makeRidge(sp, 0, narrow ? 3.2 : 4.2, cBrand, 0.05) : null;
    const nqRidge = nq ? makeRidge(nq, -4.5, narrow ? 2.6 : 3.4, cInk, 0.03) : null;

    // --- sector pillars on an arc in front ---
    const maxAbs = sectors.length ? Math.max(1, ...sectors.map((s) => Math.abs(s.changePercent))) : 1;
    const pillars: { mesh: THREE.Mesh; target: number; sector: SceneSector; mat: THREE.MeshStandardMaterial }[] = [];
    const pillarGeo = new THREE.BoxGeometry(0.72, 1, 0.72);
    pillarGeo.translate(0, 0.5, 0);
    disposables.push(pillarGeo);
    const arcR = narrow ? 7.5 : 10.5;
    sectors.forEach((s, i) => {
      const t = sectors.length === 1 ? 0.5 : i / (sectors.length - 1);
      const ang = Math.PI * (narrow ? 0.62 : 0.55) * (t - 0.5) + Math.PI / 2;
      const x = Math.cos(ang) * arcR;
      const z = Math.sin(ang) * arcR - (narrow ? 1.5 : 2.5);
      const up = s.changePercent >= 0;
      const col = up ? cUp : cDown;
      const mat = new THREE.MeshStandardMaterial({
        color: col.clone().multiplyScalar(0.25),
        emissive: col,
        emissiveIntensity: 1.6,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(pillarGeo, mat);
      mesh.position.set(x, 0, z);
      mesh.scale.y = 0.0001;
      mesh.userData.kind = "pillar";
      mesh.userData.i = i;
      scene.add(mesh);
      disposables.push(mat);
      pillars.push({ mesh, target: 0.6 + (Math.abs(s.changePercent) / maxAbs) * (narrow ? 3.0 : 4.2), sector: s, mat });
    });

    // --- rotation quadrant: tilted glass plane with spheres ---
    const quadGroup = new THREE.Group();
    const quadSize = narrow ? 6 : 8;
    quadGroup.position.set(narrow ? 0 : 8.5, narrow ? 7.5 : 6.2, narrow ? -8 : -3.5);
    quadGroup.rotation.x = -Math.PI / 2 + (narrow ? 0.9 : 0.75);
    quadGroup.rotation.y = narrow ? 0 : -0.35;
    const quadPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(quadSize, quadSize),
      new THREE.MeshBasicMaterial({ color: cBrand, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    );
    quadGroup.add(quadPlane);
    disposables.push(quadPlane.geometry, quadPlane.material as THREE.Material);
    const axisMat = new THREE.LineBasicMaterial({ color: cInk, transparent: true, opacity: 0.55 });
    const axes = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-quadSize / 2, 0, 0.01), new THREE.Vector3(quadSize / 2, 0, 0.01),
      new THREE.Vector3(0, -quadSize / 2, 0.01), new THREE.Vector3(0, quadSize / 2, 0.01),
    ]);
    quadGroup.add(new THREE.LineSegments(axes, axisMat));
    disposables.push(axes, axisMat);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(quadPlane.geometry), new THREE.LineBasicMaterial({ color: cBrand, transparent: true, opacity: 0.35 }));
    quadGroup.add(frame);
    disposables.push(frame.geometry, frame.material as THREE.Material);
    scene.add(quadGroup);
    const maxRel = dots.length ? Math.max(5, ...dots.map((d) => Math.abs(d.relative))) : 5;
    const sphereGeo = new THREE.SphereGeometry(narrow ? 0.16 : 0.2, 20, 14);
    disposables.push(sphereGeo);
    const spheres: { mesh: THREE.Mesh; dot: SceneDot; target: THREE.Vector3; mat: THREE.MeshStandardMaterial }[] = [];
    dots.forEach((d, i) => {
      const up = d.relative >= 0;
      const col = up ? cUp : cDown;
      const mat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.3), emissive: col, emissiveIntensity: 1.9, roughness: 0.3 });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      const x = (d.relative / maxRel) * (quadSize / 2) * 0.88;
      const y = ((d.band - 50) / 50) * (quadSize / 2) * 0.88;
      const target = new THREE.Vector3(x, y, 0.22);
      mesh.position.set(x, y, 9 + i * 0.4);
      mesh.userData.kind = "sphere";
      mesh.userData.i = i;
      quadGroup.add(mesh);
      disposables.push(mat);
      spheres.push({ mesh, dot: d, target, mat });
    });

    // --- particles ---
    const pCount = narrow ? 500 : 1400;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i += 1) {
      pPos[i * 3] = (Math.random() - 0.5) * 60;
      pPos[i * 3 + 1] = Math.random() * 16;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: cBrand, size: narrow ? 0.07 : 0.06, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);
    disposables.push(pGeo, pMat);

    // --- controls + parallax ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = narrow ? 0.18 : 0.25;
    controls.minPolarAngle = Math.PI * 0.28;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.target.copy(lookAt);
    const pointer = new THREE.Vector2(0, 0);
    const pointerTarget = new THREE.Vector2(0, 0);
    const onPointerMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointerTarget.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    host.addEventListener("pointermove", onPointerMove, { passive: true });

    // --- labels (HTML, projected) ---
    const labels: Label[] = [];
    const makeLabel = (text: string, anchor: THREE.Object3D, offsetY: number, cls: string) => {
      const el = document.createElement("div");
      el.className = `intro-label ${cls}`;
      el.textContent = text;
      labelsHost.appendChild(el);
      labels.push({ el, anchor, offsetY });
      return el;
    };
    pillars.forEach((p) => makeLabel(narrow ? p.sector.symbol.replace(/^XL/, "") : p.sector.name, p.mesh, 0, "intro-label-pillar"));
    if (!narrow) spheres.forEach((s) => makeLabel(s.dot.name, s.mesh, 0.35, "intro-label-sphere"));
    if (spRidge) makeLabel("S&P 500", spRidge.head, 0.5, "intro-label-ridge");
    if (nqRidge && !narrow) makeLabel("나스닥", nqRidge.head, 0.5, "intro-label-ridge intro-label-muted");
    const proj = new THREE.Vector3();
    const placeLabels = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      for (const l of labels) {
        l.anchor.getWorldPosition(proj);
        if (l.anchor.userData.kind === "pillar") proj.y += (l.anchor.scale.y || 0) + 0.45;
        else proj.y += l.offsetY;
        proj.project(camera);
        const visible = proj.z < 1 && l.anchor.visible !== false;
        l.el.style.opacity = visible ? "1" : "0";
        l.el.style.transform = `translate(-50%, -100%) translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px)`;
      }
    };

    // --- hover ---
    const raycaster = new THREE.Raycaster();
    const hoverables: THREE.Mesh[] = [...pillars.map((p) => p.mesh), ...spheres.map((s) => s.mesh)];
    let hovered: THREE.Mesh | null = null;
    const onPointerHover = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      raycaster.setFromCamera(v, camera);
      const hit = raycaster.intersectObjects(hoverables, false)[0]?.object as THREE.Mesh | undefined;
      if (hit !== hovered) {
        hovered = hit ?? null;
        let text: string | null = null;
        if (hovered?.userData.kind === "pillar") {
          const s = pillars[hovered.userData.i].sector;
          text = `${s.name} ${fmtPct(s.changePercent)}`;
        } else if (hovered?.userData.kind === "sphere") {
          const d = spheres[hovered.userData.i].dot;
          text = `${d.name} · S&P 대비 ${fmtPp(d.relative)} · 밴드 ${Math.round(d.band)}%`;
        }
        host.style.cursor = hovered ? "pointer" : "";
        onHoverRef.current?.(text);
      }
    };
    host.addEventListener("pointermove", onPointerHover, { passive: true });

    // --- resize / visibility ---
    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    let hidden = document.hidden;
    const onVis = () => {
      hidden = document.hidden;
      if (!hidden) loop();
    };
    document.addEventListener("visibilitychange", onVis);

    // --- timeline (seconds) ---
    const T = { camera: [0.2, 3.6], ridge: [0.6, 3.0], pillars: [1.8, 3.4], spheres: [2.8, 4.4], orbit: 4.0 } as const;
    const start = performance.now();
    let raf = 0;
    let ready = false;
    let orbiting = false;
    const camPos = new THREE.Vector3();
    const lookTmp = new THREE.Vector3();
    const loop = () => {
      if (hidden) return;
      raf = requestAnimationFrame(loop);
      const t = (performance.now() - start) / 1000;
      sweepMat.uniforms.uTime.value = t;

      // camera fly-in, then orbit with pointer parallax
      if (!orbiting) {
        const k = easeOut((t - T.camera[0]) / (T.camera[1] - T.camera[0]));
        camPos.lerpVectors(camFrom, camTo, k);
        camera.position.copy(camPos);
        lookTmp.copy(lookAt);
        camera.lookAt(lookTmp);
        if (t >= T.orbit) {
          orbiting = true;
          controls.enabled = true;
          controls.update();
        }
      } else {
        pointer.lerp(pointerTarget, 0.04);
        controls.target.set(lookAt.x + pointer.x * 0.9, lookAt.y + pointer.y * 0.5, lookAt.z);
        controls.update();
      }

      // ridges grow, then the line and its head appear
      const g = easeOut((t - T.ridge[0]) / (T.ridge[1] - T.ridge[0]));
      for (const m of ridgeMats) m.uniforms.uGrow.value = g;
      for (const r of [spRidge, nqRidge]) {
        if (!r) continue;
        r.tube.scale.y = Math.max(0.0001, g);
        r.head.visible = g > 0.98;
        r.head.position.set(r.top.x, r.top.y * g, r.top.z);
      }
      if (spRidge?.head.visible) spRidge.head.scale.setScalar(1 + 0.25 * Math.sin(t * 4));

      // pillars rise in sequence
      pillars.forEach((p, i) => {
        const k = easeOutBack((t - T.pillars[0] - i * 0.09) / 0.9);
        p.mesh.scale.y = Math.max(0.0001, p.target * k);
        p.mat.emissiveIntensity = p.mesh === hovered ? 3.2 : 1.6;
      });

      // spheres drop onto the quadrant
      spheres.forEach((s, i) => {
        const k = easeOutBack((t - T.spheres[0] - i * 0.07) / 1.0);
        s.mesh.position.z = 9 + i * 0.4 + (s.target.z - 9 - i * 0.4) * k;
        s.mesh.position.x = s.target.x;
        s.mesh.position.y = s.target.y;
        s.mat.emissiveIntensity = s.mesh === hovered ? 3.4 : 1.9;
      });

      // particles drift
      const arr = pGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < pCount; i += 1) {
        arr[i * 3 + 1] += 0.004 + (i % 7) * 0.0008;
        if (arr[i * 3 + 1] > 16) arr[i * 3 + 1] = 0;
      }
      pGeo.attributes.position.needsUpdate = true;

      composer.render();
      placeLabels();
      if (!ready) {
        ready = true;
        onReadyRef.current?.();
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointermove", onPointerHover);
      ro.disconnect();
      controls.dispose();
      for (const d of disposables) d.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      for (const l of labels) l.el.remove();
    };
    // The scene is built once from the data it was mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, sp, nq, sectors, dots]);

  return (
    <div className="absolute inset-0 z-0" aria-hidden="true">
      <div ref={hostRef} className="absolute inset-0 touch-pan-y" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
