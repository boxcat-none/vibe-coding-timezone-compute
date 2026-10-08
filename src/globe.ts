import * as THREE from 'three';
import { getSubsolarPoint } from './timezone';

const DEG = Math.PI / 180;
/** 未鎖定時的自轉速度（弧度/秒），約 100 秒轉一圈 */
const SPIN_SPEED = 0.06;
const IDLE_TILT = 0.25;

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
  uniform vec3 sunDir;      // 地球物件座標中的太陽方向
  uniform float reveal;
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;

  void main() {
    vec3 n = normalize(vObjNormal);
    float cosSun = dot(n, sunDir);

    // 晨昏線：在 -0.1 ~ 0.15 之間柔和過渡
    float dayMix = smoothstep(-0.1, 0.15, cosSun);

    vec3 day = texture2D(dayTex, vUv).rgb;
    vec3 dayLit = day * (0.3 + 1.0 * clamp(cosSun, 0.0, 1.0));

    vec3 nightLights = texture2D(nightTex, vUv).rgb;
    vec3 night = day * 0.06 + nightLights * vec3(2.3, 1.9, 1.35);

    vec3 color = mix(night, dayLit, dayMix);

    // 晨昏線附近的暖色餘暉
    float glow = exp(-cosSun * cosSun * 160.0);
    color += vec3(1.0, 0.42, 0.18) * glow * 0.07;

    // 邊緣大氣光暈，白天側較亮
    vec3 viewDir = normalize(-vViewPos);
    float fresnel = pow(1.0 - max(dot(normalize(vViewNormal), viewDir), 0.0), 3.0);
    color += vec3(0.35, 0.62, 1.0) * fresnel * (0.12 + 0.75 * dayMix);

    gl_FragColor = vec4(color * reveal, 1.0);
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
  uniform vec3 sunWorld;
  uniform float reveal;
  varying vec3 vWorldNormal;
  varying vec3 vViewNormal;
  void main() {
    float intensity = pow(clamp(0.72 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.6);
    float lit = 0.25 + 0.75 * smoothstep(-0.4, 0.4, dot(vWorldNormal, sunWorld));
    gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * intensity * lit * reveal, 1.0);
  }
`;

const starVertex = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float time;
  uniform float pixelRatio;
  uniform float twinkle;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vAlpha = 0.55 + 0.45 * sin(time * (0.6 + phase * 1.4) + phase * 40.0) * twinkle;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const starFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
  }
`;

export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Globe {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
  private tiltGroup = new THREE.Group();
  private earth: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private marker = new THREE.Group();
  private markerRing: THREE.Mesh;
  private clock = new THREE.Clock();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private locked = true;
  private rotY = 0;
  private tilt = IDLE_TILT;
  private targetRotY = 0;
  private lockedTilt = IDLE_TILT;
  private reveal = 0;
  private loaded = false;
  private lastSunUpdate = -Infinity;
  private stage: StageRect | null = null;

  constructor(canvas: HTMLCanvasElement) {
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
        sunDir: { value: new THREE.Vector3(1, 0, 0) },
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
        uniforms: { sunWorld: { value: new THREE.Vector3(1, 0, 0) }, reveal: { value: 0 } },
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(this.atmosphere);

    // 鎖定位置的標記
    // 深色底圈讓標記在白天的亮色地表上也看得清楚
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(0.034, 32),
      new THREE.MeshBasicMaterial({ color: 0x050816, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.02, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, depthWrite: false, transparent: true }),
    );
    core.position.z = 0.0005;
    this.markerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.038, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.marker.add(halo, core, this.markerRing);
    this.earth.add(this.marker);

    this.stars = this.createStars();
    this.scene.add(this.stars);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private createStars() {
    const count = window.innerWidth < 700 ? 1400 : 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const tints = [new THREE.Color(0xffffff), new THREE.Color(0xcfe0ff), new THREE.Color(0xfff1d6), new THREE.Color(0xaec8ff)];
    for (let i = 0; i < count; i++) {
      // 均勻分布在遠方的球殼上
      const u = Math.random() * 2 - 1;
      const θ = Math.random() * Math.PI * 2;
      const r = 80 + Math.random() * 60;
      const s = Math.sqrt(1 - u * u);
      positions.set([r * s * Math.cos(θ), r * u, r * s * Math.sin(θ)], i * 3);
      const c = tints[Math.floor(Math.random() * tints.length)];
      colors.set([c.r, c.g, c.b], i * 3);
      sizes[i] = Math.random() < 0.06 ? 2.4 + Math.random() * 1.6 : 0.8 + Math.random() * 1.4;
      phases[i] = Math.random();
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
      },
      vertexShader: starVertex,
      fragmentShader: starFragment,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geo, mat);
  }

  /** 設定地球要放在畫面中的哪個區域（以視窗座標表示） */
  setStage(rect: StageRect) {
    this.stage = rect;
    this.resize();
  }

  /** 鎖定：轉向指定經緯度；解除鎖定：繼續自轉 */
  setLocked(locked: boolean) {
    this.locked = locked;
  }

  /** 設定鎖定的位置（標記會放在這裡，鎖定時地球轉到正面） */
  setTarget(lat: number, lon: number) {
    this.marker.position.copy(latLonToVector(lat, lon, 1.002));
    this.marker.lookAt(latLonToVector(lat, lon, 2));
    // 讓經度 λ 轉到面向相機（+Z），並把緯度傾斜到中間附近
    this.targetRotY = -Math.PI / 2 - lon * DEG;
    this.lockedTilt = THREE.MathUtils.clamp(lat * DEG * 0.85, -1.1, 1.1);
  }

  /** 立即跳到目標角度（用在第一次載入） */
  snapToTarget() {
    if (this.locked) {
      this.rotY = this.targetRotY;
      this.tilt = this.lockedTilt;
    }
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    const stage = this.stage ?? { x: 0, y: 0, width: w, height: h };
    const radiusPx = Math.max(60, Math.min(stage.width, stage.height) * 0.4);
    const tanHalf = Math.tan((this.camera.fov * DEG) / 2);
    this.camera.position.z = h / (2 * tanHalf * radiusPx);

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
    this.earth.material.uniforms.sunDir.value.copy(latLonToVector(sun.lat, sun.lon));
  }

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    this.updateSun(performance.now());

    if (this.locked) {
      const ease = 1 - Math.exp(-dt * 2.5);
      this.rotY += wrapAngle(this.targetRotY - this.rotY) * ease;
      this.tilt += (this.lockedTilt - this.tilt) * ease;
    } else {
      this.rotY += SPIN_SPEED * (this.reducedMotion ? 0.3 : 1) * dt;
      this.tilt += (IDLE_TILT - this.tilt) * (1 - Math.exp(-dt * 1.5));
    }
    this.earth.rotation.y = this.rotY;
    this.tiltGroup.rotation.x = this.tilt;

    // 太陽在世界座標的方向（給大氣層用）
    this.tiltGroup.updateMatrixWorld();
    const sunWorld = this.earth.material.uniforms.sunDir.value.clone().transformDirection(this.earth.matrixWorld);
    this.atmosphere.material.uniforms.sunWorld.value.copy(sunWorld);

    if (this.loaded && this.reveal < 1) this.reveal = Math.min(1, this.reveal + dt * 0.8);
    this.earth.material.uniforms.reveal.value = this.reveal;
    this.atmosphere.material.uniforms.reveal.value = this.reveal;

    // 標記脈動
    const pulse = this.reducedMotion ? 0.5 : (t * 0.8) % 1;
    this.markerRing.scale.setScalar(1 + pulse * 1.6);
    (this.markerRing.material as THREE.MeshBasicMaterial).opacity = (1 - pulse) * this.reveal;
    this.marker.visible = this.reveal > 0.2;

    this.stars.material.uniforms.time.value = t;
    this.stars.rotation.y = t * 0.004;

    this.renderer.render(this.scene, this.camera);
  }
}
