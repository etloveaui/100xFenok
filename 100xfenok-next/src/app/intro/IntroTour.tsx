"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// ---------------------------------------------------------------------------
// 100x product tour — concept A.
// The product's own screens fly in and form a ring around the viewer; the
// camera descends into the centre and sweeps across them once, then the ring
// is yours: drag (or swipe) to turn, hover to lift a screen, click to enter it.
// Radar sweep on the floor, bloom, fog, drifting particles. Colors come from
// the intro-* CSS tokens.
// ---------------------------------------------------------------------------

export interface TourScreen {
  route: string;
  label: string;
  href: string;
  file: string;
  width: number;
  height: number;
}

export interface IntroTourProps {
  screens: TourScreen[];
  narrow: boolean;
  onReady?: () => void;
  onHover?: (screen: TourScreen | null) => void;
  onSelect?: (screen: TourScreen) => void;
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function cssColorFrom(el: Element, name: string, fallback: number): THREE.Color {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  return raw ? new THREE.Color(raw) : new THREE.Color(fallback);
}

function sweepMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 c = vUv - 0.5; float r = length(c) * 2.0; float ang = atan(c.y, c.x);
        float sweep = fract((ang / 6.28318) - uTime * 0.1);
        float trail = pow(1.0 - sweep, 6.0);
        float rings = smoothstep(0.985, 1.0, fract(r * 5.0)) * 0.22;
        float edge = 1.0 - smoothstep(0.7, 1.0, r);
        float a = (trail * 0.3 + rings) * edge * (0.2 + 0.8 * (1.0 - r));
        gl_FragColor = vec4(uColor, a);
      }`,
  });
}

export default function IntroTour({ screens, narrow, onReady, onHover, onSelect }: IntroTourProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onReady, onHover, onSelect });
  cb.current = { onReady, onHover, onSelect };

  useEffect(() => {
    const host = hostRef.current;
    const labelsHost = labelsRef.current;
    if (!host || !labelsHost || !screens.length) return;

    const root = host.closest(".intro-root") ?? document.documentElement;
    const cBg = cssColorFrom(root, "--intro-bg", 0x08090a);
    const cBrand = cssColorFrom(root, "--intro-brand", 0x3b8de8);
    const cInk = cssColorFrom(root, "--intro-ink-3", 0x7c8594);

    // --- renderer / scene / camera ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.25 : 1.35));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = cBg;
    scene.fog = new THREE.FogExp2(cBg.getHex(), 0.02);

    // Portrait phones have a narrow horizontal FOV: widen the lens and push the ring out so 2–3 screens are in view.
    const camera = new THREE.PerspectiveCamera(narrow ? 78 : 50, host.clientWidth / host.clientHeight, 0.1, 200);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Light-theme screenshots must not bloom: high threshold, low strength — only the sweep and frames glow.
    const bloom = new UnrealBloomPass(new THREE.Vector2(Math.ceil(host.clientWidth / 2), Math.ceil(host.clientHeight / 2)), 0.28, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.5);
    key.position.set(-6, 12, 8);
    scene.add(key);

    const disposables: { dispose: () => void }[] = [];

    // --- floor: grid + radar sweep ---
    const grid = new THREE.GridHelper(120, 120, cBrand.getHex(), cBrand.getHex());
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.07;
    grid.position.y = -0.01;
    scene.add(grid);
    disposables.push(grid.geometry, grid.material as THREE.Material);
    const sweepMat = sweepMaterial(cBrand);
    const sweep = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), sweepMat);
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.y = 0.005;
    scene.add(sweep);
    disposables.push(sweep.geometry, sweepMat);

    // --- particles ---
    const pCount = narrow ? 400 : 1000;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i += 1) {
      pPos[i * 3] = (Math.random() - 0.5) * 80;
      pPos[i * 3 + 1] = Math.random() * 18;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: cBrand, size: 0.06, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    scene.add(new THREE.Points(pGeo, pMat));
    disposables.push(pGeo, pMat);

    // --- the ring of screens ---
    const n = screens.length;
    const R = narrow ? 15 : 14;
    const H = narrow ? 3.0 : 3.4; // panel centre height
    const panelW = narrow ? 4.6 : 6.4;
    const loader = new THREE.TextureLoader();
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
    disposables.push(glassMat);
    type Panel = {
      group: THREE.Group;
      shot: THREE.Mesh;
      frame: THREE.LineSegments;
      frameMat: THREE.LineBasicMaterial;
      shotMat: THREE.MeshBasicMaterial;
      slot: THREE.Vector3;
      slotRot: number;
      from: THREE.Vector3;
      screen: TourScreen;
      loaded: boolean;
    };
    const panels: Panel[] = [];
    const hoverables: THREE.Mesh[] = [];
    screens.forEach((s, i) => {
      const ang = (i / n) * Math.PI * 2;
      const slot = new THREE.Vector3(Math.sin(ang) * R, H, Math.cos(ang) * R);
      const aspect = s.width && s.height ? s.width / s.height : 16 / 10;
      const w = panelW;
      const h = panelW / aspect;
      const group = new THREE.Group();
      // Dimmed so a ring of white product screens reads as glass in a dark room, not a lightbox.
      const shotMat = new THREE.MeshBasicMaterial({ color: 0xc9cdd3, transparent: true, opacity: 0 });
      const shot = new THREE.Mesh(new THREE.PlaneGeometry(w, h), shotMat);
      shot.userData.i = i;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.12, h + 0.12), glassMat);
      glass.position.z = -0.02;
      const frameGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.12, h + 0.12));
      const frameMat = new THREE.LineBasicMaterial({ color: cBrand, transparent: true, opacity: 0.55 });
      const frame = new THREE.LineSegments(frameGeo, frameMat);
      frame.position.z = -0.01;
      group.add(glass, shot, frame);
      // panels face the centre of the ring
      const slotRot = Math.atan2(-slot.x, -slot.z);
      const from = new THREE.Vector3(Math.sin(ang) * (R + 30), H + 14 + Math.random() * 6, Math.cos(ang) * (R + 30));
      group.position.copy(from);
      group.rotation.y = slotRot;
      scene.add(group);
      disposables.push(shot.geometry, shotMat, glass.geometry, frameGeo, frameMat);
      hoverables.push(shot);
      const panel: Panel = { group, shot, frame, frameMat, shotMat, slot, slotRot, from, screen: s, loaded: false };
      panels.push(panel);
      loader.load(
        s.file,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          shotMat.map = tex;
          shotMat.needsUpdate = true;
          panel.loaded = true;
          disposables.push(tex);
        },
        undefined,
        () => {
          panel.loaded = true; // keep the glass card; no texture
        },
      );
    });

    // --- labels (HTML, projected under each panel) ---
    const labels: { el: HTMLDivElement; panel: Panel }[] = [];
    for (const p of panels) {
      const el = document.createElement("div");
      el.className = "intro-label intro-label-tour";
      el.textContent = p.screen.label;
      labelsHost.appendChild(el);
      labels.push({ el, panel: p });
    }
    const proj = new THREE.Vector3();
    const placeLabels = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      for (const l of labels) {
        proj.copy(l.panel.group.position);
        proj.y -= (panelW / (l.panel.screen.width && l.panel.screen.height ? l.panel.screen.width / l.panel.screen.height : 1.6)) / 2 + 0.35;
        proj.project(camera);
        const onScreen = proj.z < 1 && Math.abs(proj.x) < 1.15;
        l.el.style.opacity = onScreen && l.panel.loaded ? "1" : "0";
        l.el.style.transform = `translate(-50%, 0) translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px)`;
      }
    };

    // --- camera: descend into the centre, sweep once, then user yaw ---
    const eye = new THREE.Vector3(0, H, 0);
    const camFrom = new THREE.Vector3(0, narrow ? 26 : 30, 0.01);
    let yaw = 0; // radians, 0 = looking at panel 0
    let pitch = 0;
    let yawVel = 0;
    let autoYaw = 0.05; // rad/s idle drift
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    let dragging = false;
    let dragX = 0;
    let dragYaw = 0;
    let moved = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      dragX = e.clientX;
      dragYaw = yaw;
      moved = 0;
      host.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointerTarget.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      if (dragging) {
        const dx = e.clientX - dragX;
        moved = Math.max(moved, Math.abs(dx));
        yaw = dragYaw - dx * (narrow ? 0.008 : 0.005);
        yawVel = 0;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (moved < 6 && hovered) {
        const p = panels[hovered.userData.i];
        cb.current.onSelect?.(p.screen);
      }
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

    // --- hover ---
    const raycaster = new THREE.Raycaster();
    let hovered: THREE.Mesh | null = null;
    const onHoverMove = (e: PointerEvent) => {
      if (dragging) return;
      const r = host.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), camera);
      const hit = raycaster.intersectObjects(hoverables, false)[0]?.object as THREE.Mesh | undefined;
      if (hit !== hovered) {
        hovered = hit ?? null;
        host.style.cursor = hovered ? "pointer" : "grab";
        cb.current.onHover?.(hovered ? panels[hovered.userData.i].screen : null);
      }
    };
    host.addEventListener("pointermove", onHoverMove, { passive: true });
    host.style.cursor = "grab";

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

    // --- timeline ---
    const T = { flyIn: [0.4, 3.0], descend: [0.6, 3.6], sweepEnd: 3.6 + n * 0.55 } as const;
    const start = performance.now();
    let last = start;
    let raf = 0;
    let ready = false;
    let interactive = false;
    const dir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const loop = () => {
      if (hidden) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      sweepMat.uniforms.uTime.value = t;

      // panels fly to their slots
      panels.forEach((p, i) => {
        const k = easeOutBack((t - T.flyIn[0] - i * 0.12) / 1.6);
        p.group.position.lerpVectors(p.from, p.slot, k);
        const fade = easeOut((t - T.flyIn[0] - i * 0.12) / 1.0);
        p.shotMat.opacity = p.loaded ? fade * 0.94 : 0;
      });

      // camera descends to the eye point, then sweeps the ring once, then hands over
      const kd = easeOut((t - T.descend[0]) / (T.descend[1] - T.descend[0]));
      tmp.lerpVectors(camFrom, eye, kd);
      if (!interactive) {
        if (t < T.descend[1]) {
          yaw = 0;
        } else if (t < T.sweepEnd) {
          yaw = ((t - T.descend[1]) / (T.sweepEnd - T.descend[1])) * Math.PI * 2;
        } else {
          interactive = true;
          yawVel = 0;
        }
      } else {
        if (!dragging) yaw += (autoYaw + yawVel) * dt;
        yawVel *= 0.92;
      }
      pointer.lerp(pointerTarget, 0.05);
      pitch = THREE.MathUtils.lerp(pitch, kd >= 1 ? pointer.y * 0.08 : -Math.PI / 2 + (Math.PI / 2 + 0.05) * kd, 0.08);
      const yawEff = yaw + (interactive ? pointer.x * 0.12 : 0);
      camera.position.copy(tmp);
      dir.set(Math.sin(yawEff) * Math.cos(pitch), Math.sin(pitch), Math.cos(yawEff) * Math.cos(pitch));
      camera.lookAt(camera.position.clone().add(dir));

      // hover lift + frame glow
      for (const p of panels) {
        const isHover = hovered === p.shot;
        const lift = isHover ? 0.7 : 0;
        const toCentre = tmp.set(-p.slot.x, 0, -p.slot.z).normalize().multiplyScalar(lift);
        const target = p.slot.clone().add(toCentre);
        if (interactive) p.group.position.lerp(target, 0.12);
        p.frameMat.opacity = THREE.MathUtils.lerp(p.frameMat.opacity, isHover ? 1 : 0.55, 0.15);
        p.frameMat.color.copy(isHover ? new THREE.Color(0xffffff) : cBrand);
      }
      void cInk;

      // particles drift
      const arr = pGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < pCount; i += 1) {
        arr[i * 3 + 1] += 0.003 + (i % 5) * 0.0006;
        if (arr[i * 3 + 1] > 18) arr[i * 3 + 1] = 0;
      }
      pGeo.attributes.position.needsUpdate = true;

      composer.render();
      placeLabels();
      if (!ready) {
        ready = true;
        cb.current.onReady?.();
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointermove", onHoverMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      ro.disconnect();
      for (const d of disposables) d.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      for (const l of labels) l.el.remove();
    };
    // Built once from the screens it mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens, narrow]);

  return (
    <div className="absolute inset-0 z-0" aria-hidden="true">
      <div ref={hostRef} className="absolute inset-0 touch-none select-none" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
