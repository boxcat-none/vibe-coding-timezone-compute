import * as THREE from 'three';
import { createNebulaCanvas, seeded } from './sky';
import { getSubsolarPoint } from './timezone';

const DEG = Math.PI / 180;
/** 未鎖定時的自轉速度（弧度/秒），約 100 秒轉一圈 */
const SPIN_SPEED = 0.06;
const IDLE_TILT = 0.25;
const MAX_TILT = 1.35;
/** 移動超過這個距離（px）就算拖曳，不算點擊 */
const DRAG_THRESHOLD = 6;
/** 自轉時地球稍微縮小，鎖定時放大聚焦 */
const ZOOM_IDLE = 0.86;
const ZOOM_LOCKED = 1.06;
/** 使用者用滾輪縮放的範圍（再大相機就會進到大氣層裡） */
const USER_ZOOM_MIN = 0.6;
const USER_ZOOM_MAX = 2.6;
/** 背景星空跟著地球轉動的比例（小於 1 有一點景深的感覺） */
const SKY_FOLLOW = 0.5;
/** 標記貼在地表的半徑（略高於地表，避免與地球重疊閃爍） */
const MARKER_RADIUS = 1.004;
/** 標記圓盤的大小（弧長） */
const MARKER_SIZE = 0.11;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export const MARKER_COLORS = [0xffc65c, 0x6fd8ff] as const;

/** 經緯度 → 地球物件座標（與 SphereGeometry 的 UV 對應，經度 0 在 +X） */
export function latLonToVector(lat: number, lon: number, radius = 1): THREE.Vector3 {
  const φ = lat * DEG;
  const λ = lon * DEG;
  return new THREE.Vector3(Math.cos(φ) * Math.cos(λ), Math.sin(φ), -Math.cos(φ) * Math.sin(λ)).multiplyScalar(radius);
}

/** 角度差取最短路徑 (-π, π] */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vObjNormal = normal;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D dayTex;
  uniform sampler2D nightTex;
  uniform float dayAmount;  // 正面中央那一點的日照程度 0～1
  uniform float reveal;
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;

  void main() {
    // 不畫晨昏線：整顆地球的日夜由正面那個時區的日照決定（dayAmount）
    float dayMix = dayAmount;

    // 從左上前方打光，保留球體的立體感
    vec3 vn = normalize(vViewNormal);
    float shade = 0.35 + 0.8 * max(dot(vn, normalize(vec3(-0.45, 0.5, 0.75))), 0.0);

    vec3 day = texture2D(dayTex, vUv).rgb;
    vec3 dayLit = day * shade;

    // 城市燈光：夜間貼圖的陸地與海洋偏藍、紅色通道幾乎為 0，城市燈光則明顯帶紅，
    // 所以用紅色通道抽出燈光；再用模糊的 mipmap 做出向外擴散的光芒
    vec3 nightTex3 = texture2D(nightTex, vUv).rgb;
    float core = smoothstep(0.02, 0.13, nightTex3.r);
    float halo = smoothstep(0.012, 0.07, texture2D(nightTex, vUv, 2.0).r);
    float haloWide = smoothstep(0.008, 0.05, texture2D(nightTex, vUv, 4.0).r);
    vec3 gold = vec3(1.0, 0.66, 0.24);
    vec3 city = gold * core * 2.4
      + vec3(1.0, 0.94, 0.8) * core * core * 1.8
      + gold * halo * 0.6
      + vec3(1.0, 0.5, 0.15) * haloWide * 0.4;

    // 夜面保留一點深藍色的地表輪廓；燈光在黃昏就開始亮起
    float lightsOn = 1.0 - smoothstep(0.0, 0.7, dayMix);
    vec3 night = nightTex3 * vec3(0.35, 0.45, 0.6) * (0.6 + 0.6 * shade) + city * lightsOn;

    vec3 color = mix(night, dayLit, dayMix);

    // 邊緣大氣光暈，白天較亮
    vec3 viewDir = normalize(-vViewPos);
    float fresnel = pow(1.0 - max(dot(vn, viewDir), 0.0), 3.0);
    color += vec3(0.35, 0.62, 1.0) * fresnel * (0.15 + 0.7 * dayMix);

    // 貼圖載入前是透明的，不會在星空上留下黑色圓盤
    gl_FragColor = vec4(color * reveal, reveal);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereVertex = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform float dayAmount;
  uniform float reveal;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  void main() {
    float intensity = pow(clamp(0.72 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.6);
    float lit = 0.3 + 0.7 * dayAmount;
    vec3 c = vec3(0.3, 0.6, 1.0) * intensity * lit * reveal;
    // 畫布是透明的，alpha 要跟著亮度，否則光暈外圈會蓋住背景
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;

const starVertex = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float time;
  uniform float pixelRatio;
  uniform float twinkle;
  uniform float brightness;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vAlpha = (0.55 + 0.45 * sin(time * (0.6 + phase * 1.4) + phase * 40.0) * twinkle) * brightness;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const starFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d2 = dot(p, p);
    // 明亮的核心 + 向外擴散的光暈
    float k = (exp(-d2 * 90.0) + 0.35 * exp(-d2 * 14.0)) * smoothstep(0.25, 0.12, d2) * vAlpha;
    gl_FragColor = vec4(vColor * k, k);
  }
`;

const nebulaVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nebulaFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float brightness;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(map, vUv).rgb * brightness;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

const markerVertex = /* glsl */ `
  attribute float rad;
  varying float vR;
  void main() {
    vR = rad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const markerFragment = /* glsl */ `
  uniform vec3 color;
  uniform float pulse;
  uniform float opacity;
  varying float vR;   // 到標記中心的弧長
  void main() {
    float d = vR;
    float halo = smoothstep(0.036, 0.03, d) * 0.6;
    float core = smoothstep(0.021, 0.017, d);
    float pr = 0.028 + pulse * 0.07;
    float ring = (1.0 - pulse) * smoothstep(0.006, 0.0, abs(d - pr));
    float lit = max(core, ring);
    float a = max(halo, lit);
    if (a < 0.003) discard;
    vec3 c = mix(vec3(0.02, 0.03, 0.09), color, lit / a);
    gl_FragColor = vec4(c, a * opacity);
  }
`;

const arcVertex = /* glsl */ `
  varying float vT;
  void main() {
    vT = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const arcFragment = /* glsl */ `
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform float time;
  uniform float opacity;
  varying float vT;
  void main() {
    // 一道光沿著連線從 A 流向 B
    float head = fract(time * 0.28);
    float d = vT - head;
    float pulse = exp(-d * d * 260.0);
    vec3 c = mix(colorA, colorB, vT);
    float a = (0.55 + pulse * 0.45) * opacity;
    gl_FragColor = vec4(c * (0.75 + pulse * 1.6) * a, a);
  }
`;

export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GlobeTarget {
  lat: number;
  lon: number;
}

interface Marker {
  group: THREE.Group;
  mat: THREE.ShaderMaterial;
}

/** 貼著球面彎曲的圓盤（球冠）：在標記自己的座標系中，z 軸朝外、原點在地表上 */
function createCapGeometry(): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(0.0001, MARKER_SIZE, 48, 10);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rad = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    // 把平面上的距離當作球面上的弧長（單位球上弧長 = 角度），投影回球面
    const k = r > 0 ? (Math.sin(r) * MARKER_RADIUS) / r : 0;
    pos.setXYZ(i, x * k, y * k, MARKER_RADIUS * Math.cos(r) - 1);
    rad[i] = r;
  }
  geo.setAttribute('rad', new THREE.BufferAttribute(rad, 1));
  geo.computeBoundingSphere();
  return geo;
}

export class Globe {
  /** 點一下（不是拖曳）：點到地球時帶有經緯度，點到背景時為 null */
  onTap: ((hit: GlobeTarget | null) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 600);
  private tiltGroup = new THREE.Group();
  private earth: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private markers: Marker[];
  /** 使用者所在地的白色標記 */
  private home: Marker;
  private homePos: THREE.Vector3 | null = null;
  /** 外部要求隱藏所在地標記（例如上方選單收起時） */
  private homeHidden = false;
  private markerGeo: THREE.BufferGeometry | null = null;
  private skyTilt = new THREE.Group();
  private skySpin = new THREE.Group();
  private nebula: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private zoom = ZOOM_IDLE;
  /** 滾輪縮放倍率，乘在自轉／鎖定的縮放上 */
  private userZoom = 1;
  private userZoomTarget = 1;
  private baseCamZ = 5;
  private arc: THREE.Mesh<THREE.TubeGeometry, THREE.ShaderMaterial> | null = null;
  private arcMat: THREE.ShaderMaterial;
  private clock = new THREE.Clock();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private targetCount = 0;
  /** 鎖定後自動轉到目標的過程中 */
  private centering = false;
  private rotY = 0;
  private tilt = IDLE_TILT;
  private velRot = SPIN_SPEED;
  private velTilt = 0;
  private targetRotY = 0;
  private targetTilt = IDLE_TILT;
  private reveal = 0;
  private loaded = false;
  private lastSunUpdate = -Infinity;
  private stage: StageRect | null = null;
  private radiusPx = 200;
  /** 地球物件座標中的太陽方向 */
  private sunDir = new THREE.Vector3(1, 0, 0);
  /** 地球正面中央那一點的日照程度（0 = 深夜，1 = 白天），平滑過渡 */
  private daylight = -1;
  private raycaster = new THREE.Raycaster();

  private drag: {
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    moved: boolean;
  } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera.position.set(0, 0, 5);
    this.scene.add(this.tiltGroup);

    // 地球
    const loader = new THREE.TextureLoader();
    const base = import.meta.env.BASE_URL;
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const loadTex = (file: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
          `${base}textures/${file}`,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = Math.min(8, maxAniso);
            resolve(t);
          },
          undefined,
          reject,
        );
      });

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayTex: { value: null },
        nightTex: { value: null },
        dayAmount: { value: 1 },
        reveal: { value: 0 },
      },
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMat);
    this.tiltGroup.add(this.earth);

    Promise.all([loadTex('earth-day.jpg'), loadTex('earth-night.jpg')])
      .then(([day, night]) => {
        earthMat.uniforms.dayTex.value = day;
        earthMat.uniforms.nightTex.value = night;
        this.loaded = true;
        canvas.dispatchEvent(new CustomEvent('globe-ready'));
      })
      .catch((err) => console.error('地球貼圖載入失敗', err));

    // 大氣層
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { dayAmount: { value: 1 }, reveal: { value: 0 } },
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(this.atmosphere);

    this.markers = MARKER_COLORS.map((c) => this.createMarker(c));
    this.home = this.createMarker(0xffffff);

    this.arcMat = new THREE.ShaderMaterial({
      uniforms: {
        colorA: { value: new THREE.Color(MARKER_COLORS[0]) },
        colorB: { value: new THREE.Color(MARKER_COLORS[1]) },
        time: { value: 0 },
        opacity: { value: 1 },
      },
      vertexShader: arcVertex,
      fragmentShader: arcFragment,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // 背景天球：星雲貼圖 + 星星，放在會跟著地球轉動的群組裡
    this.scene.add(this.skyTilt);
    this.skyTilt.add(this.skySpin);
    const nebulaTex = new THREE.CanvasTexture(createNebulaCanvas());
    nebulaTex.colorSpace = THREE.SRGBColorSpace;
    this.nebula = new THREE.Mesh(
      new THREE.SphereGeometry(200, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: { map: { value: nebulaTex }, brightness: { value: 0.3 } },
        vertexShader: nebulaVertex,
        fragmentShader: nebulaFragment,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.nebula.renderOrder = -2;
    this.stars = this.createStars();
    this.stars.renderOrder = -1;
    this.skySpin.add(this.nebula, this.stars);

    this.bindPointer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private createMarker(color: number): Marker {
    this.markerGeo ??= createCapGeometry();
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, pulse: { value: 0 }, opacity: { value: 1 } },
      vertexShader: markerVertex,
      fragmentShader: markerFragment,
      transparent: true,
      depthWrite: false,
    });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.markerGeo, mat));
    group.visible = false;
    this.earth.add(group);
    return { group, mat };
  }

  private createStars() {
    // 視野很窄，只看得到天球的一小部分，所以要放很多顆才夠密
    const small = window.innerWidth < 700;
    const dust = small ? 45000 : 90000;
    const bright = small ? 2200 : 4000;
    const count = dust + bright;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const rand = seeded(7);
    const white = new THREE.Color(0xffffff);
    const paleBlue = new THREE.Color(0xc4d2ff);
    const blue = new THREE.Color(0x6f8dff);
    const iceBlue = new THREE.Color(0xa9bfff);
    for (let i = 0; i < count; i++) {
      // 均勻分布在遠方的球殼上
      const u = rand() * 2 - 1;
      const θ = rand() * Math.PI * 2;
      const r = 120 + rand() * 40;
      const s = Math.sqrt(1 - u * u);
      positions.set([r * s * Math.cos(θ), r * u, r * s * Math.sin(θ)], i * 3);
      if (i < dust) {
        // 細碎星塵
        const c = rand() < 0.3 ? paleBlue : white;
        const dim = 0.6 + rand() * 0.6;
        colors.set([c.r * dim, c.g * dim, c.b * dim], i * 3);
        sizes[i] = 1.4 + rand() * 1.4;
      } else {
        // 帶藍色光暈的亮星
        const c = rand() < 0.75 ? blue : iceBlue;
        colors.set([c.r, c.g, c.b], i * 3);
        sizes[i] = rand() < 0.12 ? 10 + rand() * 8 : 4 + rand() * 4;
      }
      phases[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pixelRatio: { value: this.renderer.getPixelRatio() },
        twinkle: { value: this.reducedMotion ? 0 : 1 },
        brightness: { value: 1 },
      },
      vertexShader: starVertex,
      fragmentShader: starFragment,
      vertexColors: true,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }

  // ---------- 拖曳旋轉 ----------
  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      c.setPointerCapture(e.pointerId);
      this.drag = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: performance.now(),
        moved: false,
      };
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      if (!d.moved) {
        d.moved = true;
        // 使用者接手：停止自動轉向
        this.centering = false;
        c.classList.add('dragging');
      }
      const now = performance.now();
      const dt = Math.max((now - d.lastT) / 1000, 1 / 240);
      // 每像素轉動的角度，讓地表大致跟著手指移動
      const k = 1 / (this.radiusPx * this.zoom * this.userZoom);
      const dRot = (e.clientX - d.lastX) * k;
      const dTilt = (e.clientY - d.lastY) * k;
      this.rotY += dRot;
      this.tilt = THREE.MathUtils.clamp(this.tilt + dTilt, -MAX_TILT, MAX_TILT);
      // 平滑估計放開時的甩動速度
      this.velRot = this.velRot * 0.6 + (dRot / dt) * 0.4;
      this.velTilt = this.velTilt * 0.6 + (dTilt / dt) * 0.4;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastT = now;
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      c.classList.remove('dragging');
      if (!d.moved) {
        if (e.type === 'pointerup') this.onTap?.(this.pick(e.clientX, e.clientY));
        return;
      }
      // 停住一陣子才放開就不要甩動
      if (performance.now() - d.lastT > 80) {
        this.velRot = 0;
        this.velTilt = 0;
      }
      const cap = 4;
      this.velRot = THREE.MathUtils.clamp(this.velRot, -cap, cap);
      this.velTilt = THREE.MathUtils.clamp(this.velTilt, -cap, cap);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /** 螢幕座標 → 地球上的經緯度；沒點到地球時回傳 null */
  private pick(x: number, y: number): GlobeTarget | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.earth, false)[0];
    if (!hit) return null;
    const p = this.earth.worldToLocal(hit.point.clone()).normalize();
    return { lat: Math.asin(THREE.MathUtils.clamp(p.y, -1, 1)) / DEG, lon: Math.atan2(-p.z, p.x) / DEG };
  }

  /** 滾輪縮放：deltaY 為正時縮小、為負時放大 */
  zoomBy(deltaY: number) {
    this.userZoomTarget = THREE.MathUtils.clamp(this.userZoomTarget * Math.exp(-deltaY * 0.0015), USER_ZOOM_MIN, USER_ZOOM_MAX);
  }

  /** 設定地球要放在畫面中的哪個區域（以視窗座標表示） */
  setStage(rect: StageRect) {
    this.stage = rect;
    this.resize();
  }

  /** 設定鎖定目標（0～2 個）。有目標時停止自轉並轉到目標中央；沒有目標時恢復自轉 */
  /** 標出使用者的所在地（白色標記） */
  setHome(t: GlobeTarget) {
    this.homePos = latLonToVector(t.lat, t.lon);
    this.home.group.position.copy(this.homePos);
    this.home.group.quaternion.setFromUnitVectors(Z_AXIS, this.homePos);
    this.updateHome();
  }

  setHomeHidden(hidden: boolean) {
    this.homeHidden = hidden;
    this.updateHome();
  }

  /** 所在地的白點只在自轉模式、而且選單沒有收起時顯示 */
  private updateHome() {
    this.home.group.visible = !!this.homePos && !this.homeHidden && !this.targetCount;
  }

  setTargets(targets: GlobeTarget[]) {
    this.targetCount = targets.length;
    this.updateHome();
    this.markers.forEach((m, i) => {
      const t = targets[i];
      m.group.visible = !!t;
      if (!t) return;
      const n = latLonToVector(t.lat, t.lon);
      m.group.position.copy(n);
      // 在地球自己的座標系裡把標記的 z 軸轉成地表法線（lookAt 用的是世界座標，地球轉動後會歪掉）
      m.group.quaternion.setFromUnitVectors(Z_AXIS, n);
    });

    this.setArc(targets.length === 2 ? targets : null);

    if (!targets.length) {
      this.centering = false;
      return;
    }
    this.focus(targets);
  }

  /** 轉到指定地點的正面；給兩個地點時轉到兩點的中間。沒有鎖定時，轉到之後會繼續自轉 */
  focus(points: GlobeTarget[]) {
    if (!points.length) return;
    const v = new THREE.Vector3();
    for (const t of points) v.add(latLonToVector(t.lat, t.lon));
    if (v.lengthSq() < 1e-6) v.copy(latLonToVector(points[0].lat, points[0].lon));
    v.normalize();
    const lat = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1));
    const lon = Math.atan2(-v.z, v.x);
    // 讓經度轉到面向相機（+Z），並把緯度轉到正中央
    this.targetRotY = -Math.PI / 2 - lon;
    this.targetTilt = THREE.MathUtils.clamp(lat, -MAX_TILT, MAX_TILT);
    this.centering = true;
    this.velRot = 0;
    this.velTilt = 0;
  }

  /** 從指定經度開始（用在第一次載入，讓所在地面向畫面） */
  faceLongitude(lon: number) {
    this.rotY = -Math.PI / 2 - lon * DEG;
  }

  private setArc(pair: GlobeTarget[] | null) {
    if (this.arc) {
      this.earth.remove(this.arc);
      this.arc.geometry.dispose();
      this.arc = null;
    }
    if (!pair) return;
    const a = latLonToVector(pair[0].lat, pair[0].lon);
    const b = latLonToVector(pair[1].lat, pair[1].lon);
    const angle = a.angleTo(b);
    if (angle < 0.002) return;
    // 沿大圓畫一條貼著地表的弧線
    const axis = new THREE.Vector3().crossVectors(a, b);
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
    axis.normalize();
    const pts: THREE.Vector3[] = [];
    const n = Math.max(24, Math.ceil(angle * 60));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(a.clone().applyAxisAngle(axis, angle * t).multiplyScalar(1.005));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    this.arc = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(48, n * 2), 0.004, 8, false), this.arcMat);
    this.earth.add(this.arc);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    const stage = this.stage ?? { x: 0, y: 0, width: w, height: h };
    this.radiusPx = Math.max(60, Math.min(stage.width * 0.44, stage.height * 0.42));
    const tanHalf = Math.tan((this.camera.fov * DEG) / 2);
    this.baseCamZ = h / (2 * tanHalf * this.radiusPx);
    this.camera.position.z = this.baseCamZ / (this.zoom * this.userZoom);

    // 用 view offset 把地球中心移到舞台中央
    const dx = stage.x + stage.width / 2 - w / 2;
    const dy = stage.y + stage.height / 2 - h / 2;
    this.camera.setViewOffset(w, h, -dx, -dy, w, h);
    this.camera.updateProjectionMatrix();
  }

  private updateSun(now: number) {
    if (now - this.lastSunUpdate < 1000) return;
    this.lastSunUpdate = now;
    const sun = getSubsolarPoint(new Date());
    this.sunDir.copy(latLonToVector(sun.lat, sun.lon));
  }

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    this.updateSun(performance.now());

    if (this.drag?.moved) {
      // 拖曳中，角度由指標事件直接控制
    } else if (this.centering) {
      const ease = 1 - Math.exp(-dt * 2.5);
      const dRot = wrapAngle(this.targetRotY - this.rotY);
      this.rotY += dRot * ease;
      this.tilt += (this.targetTilt - this.tilt) * ease;
      if (Math.abs(dRot) < 0.001 && Math.abs(this.targetTilt - this.tilt) < 0.001) this.centering = false;
    } else {
      const spin = SPIN_SPEED * (this.reducedMotion ? 0.3 : 1);
      if (this.targetCount) {
        // 有鎖定目標：甩動的慣性慢慢停下，不再自轉
        this.velRot *= Math.exp(-dt * 2.5);
      } else {
        // 沒有目標：慣性逐漸回到自轉速度
        this.velRot += (spin - this.velRot) * (1 - Math.exp(-dt * 1.2));
      }
      this.velTilt *= Math.exp(-dt * 2.5);
      this.rotY += this.velRot * dt;
      this.tilt = THREE.MathUtils.clamp(this.tilt + this.velTilt * dt, -MAX_TILT, MAX_TILT);
      if (!this.targetCount) this.tilt += (IDLE_TILT - this.tilt) * (1 - Math.exp(-dt * 0.5));
    }
    this.earth.rotation.y = this.rotY;
    this.tiltGroup.rotation.x = this.tilt;
    // 星空跟著地球轉動
    this.skySpin.rotation.y = this.rotY * SKY_FOLLOW;
    this.skyTilt.rotation.x = this.tilt * SKY_FOLLOW;

    // 自轉時稍微縮小，鎖定時放大聚焦
    const zoomTarget = this.targetCount ? ZOOM_LOCKED : ZOOM_IDLE;
    this.zoom += (zoomTarget - this.zoom) * (1 - Math.exp(-dt * 1.8));
    this.userZoom += (this.userZoomTarget - this.userZoom) * (1 - Math.exp(-dt * 8));
    this.camera.position.z = this.baseCamZ / (this.zoom * this.userZoom);

    // 面向畫面那一點的日照：太陽方向（轉到世界座標）與相機方向（+Z）的夾角
    this.tiltGroup.updateMatrixWorld();
    const sunWorld = this.sunDir.clone().transformDirection(this.earth.matrixWorld);
    const target = THREE.MathUtils.smoothstep(sunWorld.z, -0.35, 0.35);
    // 平滑過渡，快速拖曳時亮度也不會突然跳動
    this.daylight = this.daylight < 0 ? target : this.daylight + (target - this.daylight) * (1 - Math.exp(-dt * 3));
    const day = this.daylight;
    this.earth.material.uniforms.dayAmount.value = day;
    this.atmosphere.material.uniforms.dayAmount.value = day;
    // 背景整體偏暗，白天稍微亮一點
    this.stars.material.uniforms.brightness.value = 0.9 + 0.3 * day;
    this.nebula.material.uniforms.brightness.value = 0.22 + 0.14 * day;

    if (this.loaded && this.reveal < 1) this.reveal = Math.min(1, this.reveal + dt * 0.8);
    this.earth.material.uniforms.reveal.value = this.reveal;
    this.atmosphere.material.uniforms.reveal.value = this.reveal;

    // 標記脈動
    const pulse = this.reducedMotion ? 0.5 : (t * 0.8) % 1;
    for (const m of [...this.markers, this.home]) {
      m.mat.uniforms.pulse.value = pulse;
      m.mat.uniforms.opacity.value = this.reveal;
    }
    this.arcMat.uniforms.time.value = this.reducedMotion ? 0 : t;
    this.arcMat.uniforms.opacity.value = this.reveal;

    this.stars.material.uniforms.time.value = t;

    this.renderer.render(this.scene, this.camera);
  }
}
