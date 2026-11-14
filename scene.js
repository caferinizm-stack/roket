// ─── Retra · Roket — 3D sahne (three.js) ───────────────────────────────────
// Roket, rampa, gökyüzü (irtifaya göre renk değiştirir), bulutlar, yıldızlar,
// gezegen, hız çizgileri, egzoz / duman parçacıkları ve patlama.
// Sahne yalnız görseldir: oran, patlama anı ve ödemeler sunucudadır.

import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);

/** Yumuşak yuvarlak parçacık dokusu. */
function softTexture(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bulut dokusu: birkaç yumuşak daire. */
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 176;
    const y = 50 + Math.random() * 40;
    const r = 22 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Parçacık sistemi (konum, renk, boyut, saydamlık parçacık başına). */
class Particles {
  constructor(max, texture, blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 ateş · 1 duman · 2 kıvılcım
    this.grow = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture }, uScale: { value: 300 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.mat = mat;
  }

  emit(x, y, z, vx, vy, vz, ttl, size, kind, grow = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = ttl; this.ttl[i] = ttl; this.size[i] = size; this.kind[i] = kind; this.grow[i] = grow;
  }

  update(dt, scrollY) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = 1 - this.life[i] / this.ttl[i]; // 0 → 1
      const kind = this.kind[i];
      const drag = kind === 1 ? 0.96 : 0.985;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] *= drag; this.vel[i * 3 + 2] *= drag;
      if (kind === 2) this.vel[i * 3 + 1] -= 4 * dt; // kıvılcıma yerçekimi
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt - scrollY;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      let r, g, b, a;
      if (kind === 0) { // ateş: beyaz-sarı → turuncu → koyu kırmızı
        r = 1; g = lerp(0.95, 0.3, k); b = lerp(0.7, 0.05, k); a = (1 - k) * 0.95;
      } else if (kind === 1) { // duman
        const s = lerp(0.75, 0.4, k); r = s; g = s; b = s * 1.05; a = (1 - k) * 0.35;
      } else { // kıvılcım
        r = 1; g = lerp(0.9, 0.5, k); b = 0.3; a = 1 - k;
      }
      this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
      this.alpha[i] = Math.max(0, a);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}

function buildRocket() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef2fa, metalness: 0.45, roughness: 0.32 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff3350, metalness: 0.35, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, metalness: 0.8, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc94d, metalness: 0.9, roughness: 0.25 });

  // Gövde (döndürülmüş profil)
  const prof = [
    [0.0, -1.0], [0.3, -1.0], [0.4, -0.75], [0.45, -0.3], [0.46, 0.2], [0.43, 0.6], [0.34, 0.95], [0.0, 1.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), white);
  group.add(body);
  // Burun
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.345, 0.75, 48), red);
  nose.position.y = 1.32;
  group.add(nose);
  // Şeritler
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.465, 0.465, 0.1, 48), red);
  band.position.y = -0.05;
  group.add(band);
  const band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 48), gold);
  band2.position.y = 0.72;
  group.add(band2);
  // Pencere
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 12, 32), gold);
  rim.position.set(0, 0.38, 0.445);
  group.add(rim);
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.15, 32),
    new THREE.MeshStandardMaterial({ color: 0x5fd8ff, emissive: 0x1a7fd1, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.05 }),
  );
  glass.position.set(0, 0.38, 0.447);
  group.add(glass);
  // Kanatçıklar
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(0.55, -0.45); finShape.lineTo(0.55, -0.75); finShape.lineTo(0, -0.45); finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, red);
    const pivot = new THREE.Group();
    fin.position.set(0.36, -0.42, -0.03);
    pivot.add(fin);
    pivot.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    group.add(pivot);
  }
  // Motor ağzı
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.3, 32, 1, true), dark);
  nozzle.position.y = -1.13;
  group.add(nozzle);

  // Alev (iki koni, eklemeli karışım)
  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 1.4, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flameOuter.rotation.x = Math.PI;
  flameOuter.position.y = -1.95;
  const flameInner = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.9, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flameInner.rotation.x = Math.PI;
  flameInner.position.y = -1.7;
  const flame = new THREE.Group();
  flame.add(flameOuter, flameInner);
  group.add(flame);

  const light = new THREE.PointLight(0xff8a2a, 0, 8, 1.6);
  light.position.y = -1.6;
  group.add(light);

  group.scale.setScalar(0.62);
  return { group, flame, flameOuter, flameInner, light };
}

function buildPad() {
  const pad = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f55, metalness: 0.7, roughness: 0.45 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffb020, metalness: 0.3, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.35, 40), metal);
  base.position.y = -0.18;
  pad.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 8, 48), yellow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  pad.add(ring);
  for (const sx of [-1, 1]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), metal);
    tower.position.set(sx * 1.25, 1.3, -0.3);
    pad.add(tower);
    for (let k = 0; k < 5; k++) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), yellow);
      strut.position.set(sx * 1.05, 0.4 + k * 0.5, -0.3);
      strut.rotation.z = sx * 0.5;
      pad.add(strut);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff3350 }));
    lamp.position.set(sx * 1.25, 2.65, -0.3);
    lamp.userData.blink = true;
    pad.add(lamp);
  }
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshStandardMaterial({ color: 0x0f1a33, metalness: 0.1, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.36;
  pad.add(ground);
  return pad;
}

export class RocketScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.camera.position.set(0, 0.6, 10);

    // Gökyüzü: irtifaya göre renk değiştiren arka plan düzlemi.
    this.skyU = { uAlt: { value: 0 }, uTime: { value: 0 } };
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.skyU,
        depthWrite: false,
        depthTest: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
        fragmentShader: `
          varying vec2 vUv; uniform float uAlt; uniform float uTime;
          vec3 pick(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
            if (t < 0.33) return mix(a, b, t / 0.33);
            if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
            return mix(c, d, (t - 0.66) / 0.34);
          }
          void main() {
            float a = clamp(uAlt, 0.0, 1.0);
            vec3 top = pick(vec3(0.10,0.22,0.55), vec3(0.08,0.07,0.30), vec3(0.03,0.02,0.12), vec3(0.01,0.0,0.04), a);
            vec3 bot = pick(vec3(0.98,0.55,0.35), vec3(0.45,0.20,0.55), vec3(0.10,0.05,0.28), vec3(0.03,0.01,0.09), a);
            vec3 col = mix(bot, top, smoothstep(0.0, 1.0, vUv.y));
            // Bulutsu (yüksek irtifa)
            float n = sin(vUv.x * 6.0 + uTime * 0.05) * sin(vUv.y * 5.0 - uTime * 0.04);
            col += vec3(0.35, 0.1, 0.5) * smoothstep(0.5, 1.0, a) * (0.12 + 0.12 * n) * (1.0 - abs(vUv.x - 0.6));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);

    // Işıklar
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a1840, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 6, 6);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8b5cff, 1.6);
    rim.position.set(-6, 2, -3);
    this.scene.add(rim);

    // Yıldızlar
    const starN = 700;
    const sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 60;
      sp[i * 3 + 1] = (Math.random() - 0.5) * 40;
      sp[i * 3 + 2] = -10 - Math.random() * 40;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, map: softTexture(32), transparent: true, depthWrite: false, opacity: 0 });
    this.stars = new THREE.Points(sg, this.starMat);
    this.scene.add(this.stars);

    // Hız çizgileri
    const lineN = 60;
    const lp = new Float32Array(lineN * 6);
    for (let i = 0; i < lineN; i++) this.#resetLine(lp, i, true);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);

    // Bulutlar
    const ct = cloudTexture();
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, opacity: 0.8 }));
      s.scale.set(5 + Math.random() * 4, 2.4 + Math.random() * 1.5, 1);
      s.position.set((Math.random() - 0.5) * 14, 2 + i * 3.2, -3 - Math.random() * 6);
      this.clouds.push(s);
      this.scene.add(s);
    }

    // Gezegen
    const planet = new THREE.Group();
    const pm = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 48, 48),
      new THREE.MeshStandardMaterial({ color: 0x7a4dff, emissive: 0x2a0f6b, emissiveIntensity: 0.6, roughness: 0.8 }),
    );
    const ringM = new THREE.Mesh(
      new THREE.RingGeometry(2.9, 4.2, 64),
      new THREE.MeshBasicMaterial({ color: 0xffc98a, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }),
    );
    ringM.rotation.x = 1.25;
    planet.add(pm, ringM);
    planet.position.set(-6, 14, -22);
    this.planet = planet;
    this.scene.add(planet);

    // Rampa + roket
    this.pad = buildPad();
    this.pad.position.set(0, -2.8, 0);
    this.scene.add(this.pad);
    const r = buildRocket();
    this.rocket = r;
    this.scene.add(r.group);

    // Parçacıklar
    this.fire = new Particles(500, softTexture(64), THREE.AdditiveBlending);
    this.smoke = new Particles(380, softTexture(64), THREE.NormalBlending);
    this.scene.add(this.smoke.points, this.fire.points);

    // Patlama parçaları
    this.debris = [];
    const dm = new THREE.MeshStandardMaterial({ color: 0xdfe4ef, metalness: 0.5, roughness: 0.4 });
    const dr = new THREE.MeshStandardMaterial({ color: 0xff3350, metalness: 0.4, roughness: 0.4 });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12 + Math.random() * 0.14, 0.08, 0.12 + Math.random() * 0.1), i % 3 ? dm : dr);
      m.visible = false;
      m.userData.v = new THREE.Vector3();
      m.userData.w = new THREE.Vector3();
      this.debris.push(m);
      this.scene.add(m);
    }
    this.boomLight = new THREE.PointLight(0xffa040, 0, 20, 1.4);
    this.scene.add(this.boomLight);

    // Durum
    this.mode = 'idle'; // idle · launch · fly · boom
    this.modeT = 0;
    this.alt = 0;        // 0..1 gökyüzü rengi
    this.speed = 0;      // dünya kayma hızı
    this.mult = 1;
    this.countdown = 99;
    this.time = 0;
    this.shake = 0;
    this.zoom = 0;        // 0 normal · 1 odak (roket yakın plan)
    this.zoomTarget = 0;
    this.rocketPos = new THREE.Vector3(0, -1.7, 0);
    this.#placeOnPad();
    this.resize();
  }

  #resetLine(arr, i, initial) {
    const x = (Math.random() - 0.5) * 16;
    const y = initial ? (Math.random() - 0.5) * 14 : 8 + Math.random() * 6;
    const z = -2 - Math.random() * 10;
    const len = 0.6 + Math.random() * 1.6;
    arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
    arr[i * 6 + 3] = x; arr[i * 6 + 4] = y + len; arr[i * 6 + 5] = z;
  }

  #placeOnPad() {
    this.rocketPos.set(0, -1.7, 0);
    this.rocket.group.position.copy(this.rocketPos);
    this.rocket.group.rotation.set(0, 0, 0);
    this.rocket.group.visible = true;
    this.pad.position.set(0, -2.8, 0);
    this.pad.visible = true;
    for (const c of this.clouds) c.material.opacity = 0.8;
    this.planet.position.set(-6, 14, -22);
  }

  resize() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Dar ekranda roket ve rampa sığsın.
    this.camera.fov = w / h < 0.9 ? 55 : 45;
    this.camera.updateProjectionMatrix();
    this.fire.mat.uniforms.uScale.value = h * 0.9;
    this.smoke.mat.uniforms.uScale.value = h * 0.9;
  }

  /** Odak kipi: kamera rokete yaklaşır (son 3 sn + uçuş), sonra geri çekilir. */
  setFocus(on) { this.zoomTarget = on ? 1 : 0; }

  /** Yeni tur: roket rampada, gökyüzü baştan. */
  reset() {
    this.mode = 'idle';
    this.modeT = 0;
    this.alt = 0;
    this.speed = 0;
    this.mult = 1;
    this.fire.clear();
    this.smoke.clear();
    for (const d of this.debris) d.visible = false;
    this.#placeOnPad();
  }

  /** Bahis bitti, roket kalkıyor. */
  launch() {
    if (this.mode === 'launch' || this.mode === 'fly') return;
    if (this.mode === 'boom') this.reset();
    this.mode = 'launch';
    this.modeT = 0;
    this.shake = 0.6;
  }

  /** Roket patladı. */
  explode() {
    if (this.mode === 'boom') return;
    const p = this.rocket.group.position.clone();
    this.mode = 'boom';
    this.modeT = 0;
    this.rocket.group.visible = false;
    this.shake = 1;
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * Math.PI;
      const sp = 2 + Math.random() * 5;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 0.6 + Math.random() * 0.6, 0.5 + Math.random() * 0.6, 0, 1.2);
    }
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 2.2;
      this.smoke.emit(p.x, p.y, p.z, Math.cos(a) * sp, Math.sin(a) * sp, (Math.random() - 0.5) * sp, 1.4 + Math.random() * 1.2, 0.8 + Math.random() * 0.7, 1, 1.4);
    }
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 6;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sp, Math.sin(a) * sp + 2, (Math.random() - 0.5) * 3, 0.8 + Math.random() * 0.6, 0.12, 2, 0);
    }
    for (const d of this.debris) {
      d.visible = true;
      d.position.copy(p);
      d.userData.v.set((Math.random() - 0.5) * 8, Math.random() * 6 + 1, (Math.random() - 0.5) * 4);
      d.userData.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    }
    this.boomLight.position.copy(p);
    this.boomLight.intensity = 60;
  }

  /** Her kare: oran (uçuşta), geri sayım (bahiste). */
  frame(dt, { mult = 1, countdown = 99 } = {}) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.mult = mult;
    this.countdown = countdown;
    this.modeT += dt;
    const r = this.rocket;

    // Hedef irtifa / hız (orana göre)
    const lm = Math.log(Math.max(1, mult));
    let targetSpeed = 0;
    let targetAlt = 0;
    if (this.mode === 'fly' || this.mode === 'launch') {
      targetSpeed = 3 + lm * 7;
      targetAlt = clamp(lm / Math.log(12), 0, 1);
    } else if (this.mode === 'boom') {
      targetSpeed = 0;
      targetAlt = this.alt;
    }
    this.speed = lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * 2));
    this.alt = lerp(this.alt, targetAlt, 1 - Math.exp(-dt * 1.2));
    const scroll = this.speed * dt;

    // Kalkış: rampadan yukarı süzülür, rampa aşağı kayar.
    if (this.mode === 'idle') {
      r.group.position.set(0, -1.7, 0);
      r.group.rotation.z = 0;
      // Son 3 saniyede buhar
      if (countdown <= 3 && Math.random() < 0.7) {
        for (let k = 0; k < 2; k++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          this.smoke.emit(dir * 0.3, -2.45, 0.2, dir * (1.5 + Math.random() * 2), Math.random() * 0.4, (Math.random() - 0.5), 1.2, 0.5, 1, 1.2);
        }
      }
      // Rampa lambaları
      for (const o of this.pad.children) if (o.userData.blink) o.material.color.setHex(Math.sin(this.time * 6) > 0 ? 0xff3350 : 0x551018);
    }
    if (this.mode === 'launch') {
      const k = smooth(clamp(this.modeT / 1.8, 0, 1));
      r.group.position.y = lerp(-1.7, -0.4, k);
      this.pad.position.y = -2.8 - this.modeT * this.modeT * 2.2;
      if (this.modeT > 1.8) this.mode = 'fly';
    }
    if (this.mode === 'fly' || this.mode === 'launch') {
      if (this.mode === 'fly') {
        this.pad.position.y -= scroll;
        if (this.pad.position.y < -30) this.pad.visible = false;
      }
      // Hafif salınım
      const sway = Math.sin(this.time * 1.3) * 0.25 + Math.sin(this.time * 2.7) * 0.08;
      r.group.position.x = lerp(r.group.position.x, sway * 0.8, 0.05);
      r.group.rotation.z = -sway * 0.12;
      r.group.rotation.y += dt * 0.6;
      // Alev
      const fl = 0.85 + Math.random() * 0.35 + lm * 0.15;
      r.flame.visible = true;
      r.flame.scale.set(1 + Math.random() * 0.1, fl, 1 + Math.random() * 0.1);
      r.light.intensity = 25 + Math.random() * 15;
      // Egzoz parçacıkları (roketin altından)
      const base = r.group.position;
      const n = this.mode === 'launch' ? 6 : 4;
      for (let k = 0; k < n; k++) {
        this.fire.emit(base.x + (Math.random() - 0.5) * 0.12, base.y - 1.05, base.z, (Math.random() - 0.5) * 0.8, -3 - Math.random() * 2 - this.speed * 0.3, (Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.25, 0.32 + Math.random() * 0.2, 0, 0.6);
      }
      if (Math.random() < 0.9) {
        this.smoke.emit(base.x + (Math.random() - 0.5) * 0.2, base.y - 1.3, base.z - 0.2, (Math.random() - 0.5) * 0.6, -1.5 - this.speed * 0.2, (Math.random() - 0.5) * 0.4, 1.6 + Math.random(), 0.5, 1, 1.0);
      }
    } else {
      r.flame.visible = false;
      r.light.intensity = 0;
    }

    // **Ateşleme** (kalkışa son 3 sn): motor yanar, alev büyür, rampa titrer.
    if (this.mode === 'idle' && countdown <= 3 && countdown > 0) {
      const ign = 1 - clamp(countdown / 3, 0, 1); // 0 → 1
      r.flame.visible = true;
      const fl = 0.25 + ign * 0.75 + Math.random() * 0.2;
      r.flame.scale.set(0.8 + Math.random() * 0.1, fl, 0.8 + Math.random() * 0.1);
      r.light.intensity = 6 + ign * 22 + Math.random() * 6;
      const base = r.group.position;
      const n = 1 + Math.round(ign * 4);
      for (let k = 0; k < n; k++) {
        this.fire.emit(base.x + (Math.random() - 0.5) * 0.15, base.y - 1.05, base.z, (Math.random() - 0.5) * 1.4, -1.5 - Math.random() * 1.5, (Math.random() - 0.5) * 0.6, 0.25 + Math.random() * 0.2, 0.28 + ign * 0.2, 0, 0.6);
      }
      this.shake = Math.max(this.shake, 0.12 + ign * 0.25);
    }

    // Patlama sonrası
    if (this.mode === 'boom') {
      this.boomLight.intensity *= Math.exp(-dt * 4);
      for (const d of this.debris) {
        if (!d.visible) continue;
        d.userData.v.y -= 7 * dt;
        d.position.addScaledVector(d.userData.v, dt);
        d.rotation.x += d.userData.w.x * dt; d.rotation.y += d.userData.w.y * dt; d.rotation.z += d.userData.w.z * dt;
        if (d.position.y < -12) d.visible = false;
      }
    }

    // Dünya kayar: bulutlar, yıldızlar, hız çizgileri, gezegen
    for (const c of this.clouds) {
      c.position.y -= scroll * 0.9;
      c.material.opacity = 0.8 * (1 - smooth(clamp(this.alt * 2.2, 0, 1)));
      if (c.position.y < -9) { c.position.y += 30; c.position.x = (Math.random() - 0.5) * 14; }
    }
    this.starMat.opacity = clamp(0.15 + this.alt * 1.2, 0, 1);
    const sp = this.stars.geometry.attributes.position.array;
    for (let i = 0; i < sp.length; i += 3) {
      sp[i + 1] -= scroll * 0.15;
      if (sp[i + 1] < -20) sp[i + 1] += 40;
    }
    this.stars.geometry.attributes.position.needsUpdate = true;
    const lp = this.lines.geometry.attributes.position.array;
    this.lineMat.opacity = clamp((this.speed - 6) / 14, 0, 0.55);
    for (let i = 0; i < lp.length / 6; i++) {
      lp[i * 6 + 1] -= scroll * 2.2; lp[i * 6 + 4] -= scroll * 2.2;
      if (lp[i * 6 + 4] < -8) this.#resetLine(lp, i, false);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    if (this.alt > 0.25 || this.planet.position.y < 14) this.planet.position.y -= scroll * 0.05;
    if (this.planet.position.y < -16) this.planet.position.set(5 + Math.random() * 3, 16, -24);
    this.planet.rotation.y += dt * 0.05;

    this.fire.update(dt, this.mode === 'boom' ? 0 : scroll * 0.3);
    this.smoke.update(dt, this.mode === 'boom' ? 0 : scroll * 0.5);

    // Kamera: hafif takip + sarsıntı
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const sh = this.shake * 0.12 + (this.mode === 'fly' ? Math.min(0.03, lm * 0.008) : 0);
    // Odak: kamera yumuşakça rokete yaklaşır (tam ekran yakın plan).
    this.zoom = lerp(this.zoom, this.zoomTarget, 1 - Math.exp(-dt * 3));
    const ry = this.rocket.group.visible ? this.rocket.group.position.y : -0.2;
    this.camera.position.x = (Math.random() - 0.5) * sh;
    this.camera.position.y = lerp(0.6, ry + 0.9, this.zoom * 0.6) + (Math.random() - 0.5) * sh;
    this.camera.position.z = 10 - this.zoom * 3.4;
    this.camera.lookAt(0, lerp(-0.2, ry + 0.2, this.zoom * 0.7), 0);

    this.skyU.uAlt.value = this.alt;
    this.skyU.uTime.value = this.time;
    this.renderer.render(this.scene, this.camera);
  }
}
