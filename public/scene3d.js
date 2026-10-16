import * as THREE from './vendor/three/three.module.min.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const easeInOut = value => value < .5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
const easeOut = value => 1 - Math.pow(1 - value, 3);

function seedFrom(value) {
  let seed = 2166136261;
  for (const char of String(value)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0 || 1;
}

function randomFor(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function clipVoronoiCell(site, sites, width) {
  let polygon = [
    new THREE.Vector2(0, 0), new THREE.Vector2(width, 0),
    new THREE.Vector2(width, 1), new THREE.Vector2(0, 1),
  ];
  for (const other of sites) {
    if (other === site) continue;
    const dx = 2 * (other.x - site.x);
    const dy = 2 * (other.y - site.y);
    const limit = other.x * other.x + other.y * other.y - site.x * site.x - site.y * site.y;
    const next = [];
    for (let index = 0; index < polygon.length; index++) {
      const current = polygon[index];
      const following = polygon[(index + 1) % polygon.length];
      const currentDistance = dx * current.x + dy * current.y - limit;
      const followingDistance = dx * following.x + dy * following.y - limit;
      const currentInside = currentDistance <= 1e-8;
      const followingInside = followingDistance <= 1e-8;
      if (currentInside) next.push(current);
      if (currentInside !== followingInside) {
        const amount = currentDistance / (currentDistance - followingDistance);
        next.push(new THREE.Vector2(
          current.x + (following.x - current.x) * amount,
          current.y + (following.y - current.y) * amount,
        ));
      }
    }
    polygon = next;
    if (polygon.length < 3) break;
  }
  return polygon;
}

function edgeNoiseKey(a, b) {
  const left = a.x < b.x || (a.x === b.x && a.y <= b.y) ? a : b;
  const right = left === a ? b : a;
  return `${left.x.toFixed(5)},${left.y.toFixed(5)}:${right.x.toFixed(5)},${right.y.toFixed(5)}`;
}

function tornVoronoiEdges(polygon, ratio) {
  const result = [];
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!index) result.push(start);
    const onOuterEdge = (Math.abs(start.x) < 1e-5 && Math.abs(end.x) < 1e-5)
      || (Math.abs(start.x - end.x) < 1e-5 && (Math.abs(start.x) < 1e-5 || Math.abs(start.x - ratio) < 1e-5))
      || (Math.abs(start.y) < 1e-5 && Math.abs(end.y) < 1e-5)
      || (Math.abs(start.y - 1) < 1e-5 && Math.abs(end.y - 1) < 1e-5);
    if (onOuterEdge) { result.push(end); continue; }
    const forward = start.x < end.x || (start.x === end.x && start.y <= end.y);
    const a = forward ? start : end;
    const b = forward ? end : start;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = new THREE.Vector2(-dy / length, dx / length);
    const noise = randomFor(seedFrom(edgeNoiseKey(a, b)));
    const samples = [0, 1, 2].map(step => {
      const amount = (step + 1) / 4;
      const offset = (noise() - .5) * .009;
      const point = new THREE.Vector2(a.x + dx * amount, a.y + dy * amount).addScaledVector(normal, offset);
      point.x = clamp(point.x, 0, ratio);
      point.y = clamp(point.y, 0, 1);
      return point;
    });
    result.push(...(forward ? samples : samples.reverse()), end);
  }
  return result;
}

function generateVoronoiCells(ratio, seed) {
  const random = randomFor(seed);
  const count = 8;
  const sites = [];
  let attempts = 0;
  while (sites.length < count && attempts++ < count * 200) {
    const site = { x: random() * ratio, y: random() };
    const minDistance = .08;
    if (sites.every(other => Math.hypot((site.x - other.x) / ratio, site.y - other.y) > minDistance)) sites.push(site);
  }
  while (sites.length < count) sites.push({ x: random() * ratio, y: random() });
  return sites.map(site => tornVoronoiEdges(clipVoronoiCell(site, sites, ratio), ratio)).filter(poly => poly.length >= 3);
}

function addVertex(target, x, y, z, u, v) {
  target.positions.push(x, y, z);
  target.uvs.push(u, v);
}

function createPaperGeometry(polygon, ratio, scale) {
  const contour = polygon.map(point => new THREE.Vector2(point.x / ratio * ratio, point.y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!triangles.length) return null;
  const center = polygon.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / polygon.length);
  const thickness = .018;
  const data = { positions: [], uvs: [] };
  const groups = [];

  for (const triangle of triangles) {
    for (const vertexIndex of triangle) {
      const point = polygon[vertexIndex];
      addVertex(data,
        (point.x - center.x) * scale, (center.y - point.y) * scale, thickness / 2,
        point.x / ratio, 1 - point.y);
    }
  }
  groups.push({ start: 0, count: data.positions.length / 3, material: 0 });
  const backStart = data.positions.length / 3;
  for (const triangle of triangles) {
    for (const vertexIndex of [triangle[0], triangle[2], triangle[1]]) {
      const point = polygon[vertexIndex];
      addVertex(data,
        (point.x - center.x) * scale, (center.y - point.y) * scale, -thickness / 2,
        point.x / ratio, 1 - point.y);
    }
  }
  groups.push({ start: backStart, count: data.positions.length / 3 - backStart, material: 1 });
  const sideStart = data.positions.length / 3;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const ax = (a.x - center.x) * scale, ay = (center.y - a.y) * scale;
    const bx = (b.x - center.x) * scale, by = (center.y - b.y) * scale;
    const au = a.x / ratio, av = 1 - a.y, bu = b.x / ratio, bv = 1 - b.y;
    addVertex(data, ax, ay, thickness / 2, au, av); addVertex(data, bx, by, thickness / 2, bu, bv); addVertex(data, bx, by, -thickness / 2, bu, bv);
    addVertex(data, ax, ay, thickness / 2, au, av); addVertex(data, bx, by, -thickness / 2, bu, bv); addVertex(data, ax, ay, -thickness / 2, au, av);
  }
  groups.push({ start: sideStart, count: data.positions.length / 3 - sideStart, material: 2 });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  for (const group of groups) geometry.addGroup(group.start, group.count, group.material);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, center };
}

export class EtherScene {
  constructor({ canvas, getImageUrl, onOpen = () => {}, onRestore = () => {}, onProgress = () => {}, onError = () => {}, reducedMotion = false }) {
    this.canvas = canvas;
    this.getImageUrl = getImageUrl;
    this.onOpen = onOpen;
    this.onRestore = onRestore;
    this.onProgress = onProgress;
    this.onError = onError;
    this.reducedMotion = reducedMotion;
    this.photos = new Map();
    this.activeCollage = null;
    this.drag = null;
    this.hovered = null;
    this.time = 0;
    this.lastFrame = 0;
    this.cameraUserMoved = false;
    this.disposed = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, .1, 300);
    this.camera.position.set(0, 0, 20.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.AmbientLight(0xe8e9e8, .78));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(-5, 7, 12);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc4c7c7, .32);
    fill.position.set(6, -5, 4);
    this.scene.add(fill);
    this.addDust();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .055;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 58;
    this.controls.rotateSpeed = .38;
    this.controls.zoomSpeed = .52;
    this.controls.panSpeed = .48;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', this.onCameraStart);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane();
    this.dragNormal = new THREE.Vector3();
    this.dragHit = new THREE.Vector3();
    this.tempVector = new THREE.Vector3();
    this.temporaryQuaternion = new THREE.Quaternion();

    this.onPointerDown = event => this.handlePointerDown(event);
    this.onPointerMove = event => this.handlePointerMove(event);
    this.onPointerUp = event => this.handlePointerUp(event, false);
    this.onPointerCancel = event => this.handlePointerUp(event, true);
    this.onLostPointerCapture = event => {
      if (this.drag?.pointerId === event.pointerId) this.handlePointerUp(event, true);
    };
    this.onDoubleClick = event => this.handleDoubleClick(event);
    this.onWindowBlur = () => this.handlePointerUp(null, true);
    canvas.addEventListener('pointerdown', this.onPointerDown, true);
    canvas.addEventListener('pointermove', this.onPointerMove, true);
    canvas.addEventListener('pointerup', this.onPointerUp, true);
    canvas.addEventListener('pointercancel', this.onPointerCancel, true);
    canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('blur', this.onWindowBlur);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop(now => this.frame(now));
  }

  onCameraStart = () => { this.cameraUserMoved = true; };

  addDust() {
    const random = randomFor(0x45544852);
    const positions = [];
    for (let index = 0; index < 105; index++) {
      positions.push((random() - .5) * 72, (random() - .5) * 45, -24 - random() * 64);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xcbd0d0, size: .035, transparent: true, opacity: .48, depthWrite: false, sizeAttenuation: true });
    this.dust = new THREE.Points(geometry, material);
    this.scene.add(this.dust);
  }

  getPhotoHeight(ratio = 1) {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const distance = aspect < .82 ? 24.5 : 20.5;
    const fov = aspect < .82 ? 48 : aspect < 1.15 ? 45 : 42;
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const viewWidth = viewHeight * aspect;
    return Math.min(9.1, viewHeight * .59, viewWidth * .52 / ratio);
  }

  layoutFor(index, count) {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    if (count === 1) return new THREE.Vector3(0, 0, 0);
    if (count === 2 && aspect < .82) return new THREE.Vector3(index ? 0 : -.04, index ? -4.8 : 4.8, index ? -.7 : .7);
    if (count === 2) return new THREE.Vector3(index ? 5.7 : -5.7, index ? -.45 : .45, index ? .8 : -.8);
    const angle = index * 2.399963229728653;
    const radius = 5.5 + Math.sqrt(index) * 3.2;
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * .58, -Math.floor(index / 4) * 1.7 + (index % 2) * .6);
  }

  setMemories(memories) {
    const ids = new Set(memories.map(memory => memory.id));
    for (const [memoryId, entry] of this.photos) {
      if (!ids.has(memoryId)) this.disposeEntry(entry);
    }
    memories.forEach((memory, index) => {
      let entry = this.photos.get(memory.id);
      if (!entry) entry = this.createPhotoEntry(memory, index);
      entry.memory = memory;
      if (!entry.userMoved && !entry.collage) entry.layoutTarget.copy(this.layoutFor(index, memories.length));
      if (entry.material) entry.material.opacity = this.historyFocusId && this.historyFocusId !== memory.id ? .28 : 1;
    });
  }

  createPhotoEntry(memory, index) {
    const ratio = clamp(memory.width / Math.max(1, memory.height), .28, 3.2);
    const random = randomFor(seedFrom(memory.id));
    const group = new THREE.Group();
    const height = 1;
    const backingGeometry = new THREE.PlaneGeometry(ratio + .026, height + .026);
    const backingMaterial = new THREE.MeshStandardMaterial({ color: 0xc7c9c5, roughness: .96, metalness: 0, side: THREE.DoubleSide });
    const backing = new THREE.Mesh(backingGeometry, backingMaterial);
    backing.position.z = -.026;
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .4, depthWrite: false, side: THREE.DoubleSide });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(ratio + .20, height + .20), shadowMaterial);
    shadow.position.set(.10, -.11, -.06);
    group.add(shadow, backing);
    const photoHeight = this.getPhotoHeight(ratio);
    const entry = {
      id: memory.id, memory, group, backing, shadow, mesh: null, texture: null, material: null,
      ratio, random, basePosition: this.layoutFor(index, 2), layoutTarget: this.layoutFor(index, 2),
      velocity: new THREE.Vector3(), lastDrift: new THREE.Vector3(), baseRotation: new THREE.Euler((random() - .5) * .055, (random() - .5) * .08, (random() - .5) * .045),
      phase: random() * Math.PI * 2, frequencyX: .075 + random() * .028, frequencyY: .091 + random() * .033,
      frequencyZ: .062 + random() * .035, ampX: .20 + random() * .11, ampY: .17 + random() * .10, ampZ: .10 + random() * .08,
      floatScale: this.reducedMotion ? .25 : 1, userMoved: false, dragging: false, collage: null, returnTween: null,
    };
    entry.group.scale.setScalar(photoHeight);
    entry.group.position.copy(entry.basePosition);
    this.scene.add(group);
    this.photos.set(memory.id, entry);
    const texture = new THREE.TextureLoader().load(this.getImageUrl(memory), loaded => {
      if (this.photos.get(memory.id) !== entry || this.disposed) { loaded.dispose(); return; }
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      loaded.needsUpdate = true;
      entry.texture = loaded;
      entry.material = new THREE.MeshStandardMaterial({ map: loaded, roughness: .97, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 1 });
      entry.mesh = new THREE.Mesh(new THREE.PlaneGeometry(ratio, height), entry.material);
      entry.mesh.userData = { kind: 'photo', entry };
      group.add(entry.mesh);
    }, undefined, error => this.onError(error, memory));
    texture.colorSpace = THREE.SRGBColorSpace;
    entry.texture = texture;
    return entry;
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.parentElement.clientWidth);
    const height = Math.max(1, this.canvas.parentElement.clientHeight);
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.fov = aspect < .82 ? 48 : aspect < 1.15 ? 45 : 42;
    this.camera.updateProjectionMatrix();
    for (const entry of this.photos.values()) {
      entry.group.scale.setScalar(this.getPhotoHeight(entry.ratio));
      if (!entry.userMoved && !entry.collage) entry.layoutTarget.copy(this.layoutFor([...this.photos.keys()].indexOf(entry.id), this.photos.size));
    }
    if (!this.cameraUserMoved && !this.activeCollage) {
      this.camera.position.set(0, 0, aspect < .82 ? 24.5 : 20.5);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  setReducedMotion(value) { this.reducedMotion = value; }

  resetCamera() {
    if (this.activeCollage) {
      const collage = this.activeCollage;
      if (collage.phase !== 'settled') return;
      const target = collage.entry.group.position.clone();
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
      const distance = aspect < .82 ? 22 : 18.5;
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.cameraUserMoved = false;
    this.controls.reset();
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.camera.position.set(0, 0, aspect < .82 ? 24.5 : 20.5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  focusMemory(memoryId) {
    this.historyFocusId = memoryId;
    for (const entry of this.photos.values()) {
      if (entry.material) entry.material.opacity = memoryId && memoryId !== entry.id ? .28 : 1;
    }
  }

  pointerRay(event) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  intersect(event, objects) {
    this.pointerRay(event);
    return this.raycaster.intersectObjects(objects, false);
  }

  beginDrag(event, kind, object, owner) {
    this.dragNormal.copy(this.camera.getWorldDirection(this.dragNormal));
    this.dragPlane.setFromNormalAndCoplanarPoint(this.dragNormal, object.position);
    this.pointerRay(event);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragHit)) return false;
    const rotation = object.quaternion.clone();
    this.drag = {
      kind, object, owner, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      moved: false, startPosition: object.position.clone(), startRotation: rotation,
      startHit: this.dragHit.clone(), lastPosition: object.position.clone(), lastTime: performance.now(), velocity: new THREE.Vector3(),
    };
    if (kind === 'photo') owner.dragging = true;
    this.controls.enabled = false;
    this.canvas.setPointerCapture(event.pointerId);
    return true;
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.drag || this.activeCollage?.phase === 'restoring') return;
    if (this.activeCollage) {
      if (this.activeCollage.phase !== 'settled') return;
      const pieces = this.activeCollage.shards.map(piece => piece.mesh).filter(mesh => mesh.visible);
      const hit = this.intersect(event, pieces)[0];
      if (!hit) return;
      const piece = hit.object.userData.piece;
      if (piece.snapping) return;
      if (this.beginDrag(event, 'piece', piece.mesh, piece)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    const photoMeshes = [...this.photos.values()].map(entry => entry.mesh).filter(Boolean);
    const hit = this.intersect(event, photoMeshes)[0];
    if (!hit) return;
    const entry = hit.object.userData.entry;
    if (this.beginDrag(event, 'photo', entry.group, entry)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }

  handlePointerMove(event) {
    if (this.drag) {
      if (event.pointerId !== this.drag.pointerId) return;
      const drag = this.drag;
      const screenDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (screenDistance > 5) {
        drag.moved = true;
        if (drag.kind === 'piece' && drag.owner.placed) this.setShardPlaced(drag.owner, false);
      }
      this.pointerRay(event);
      const hit = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragHit);
      if (hit) {
        const position = this.drag.startPosition.clone().add(this.dragHit.clone().sub(drag.startHit));
        drag.object.position.copy(position);
        const now = performance.now();
        const elapsed = Math.max(.008, (now - drag.lastTime) / 1000);
        drag.velocity.copy(position).sub(drag.lastPosition).divideScalar(elapsed).multiplyScalar(.20).clampLength(0, 2.7);
        drag.lastPosition.copy(position);
        drag.lastTime = now;
        if (drag.kind === 'photo') {
          const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
          drag.object.rotation.x = drag.startRotation.x - clamp(dy * .0007, -.18, .18);
          drag.object.rotation.y = drag.startRotation.y + clamp(dx * .0007, -.18, .18);
        } else {
          drag.object.rotation.x = drag.startRotation.x - clamp((event.clientY - drag.startY) * .0005, -.14, .14);
          drag.object.rotation.y = drag.startRotation.y + clamp((event.clientX - drag.startX) * .0005, -.14, .14);
        }
      }
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    if (event.buttons) return;
    const candidates = this.activeCollage?.phase === 'settled'
      ? this.activeCollage.shards.map(piece => piece.mesh).filter(mesh => mesh.visible)
      : [...this.photos.values()].map(entry => entry.mesh).filter(Boolean);
    const hit = this.intersect(event, candidates)[0];
    const next = hit?.object.userData.piece || hit?.object.userData.entry || null;
    if (this.hovered !== next) {
      this.hovered = next;
      this.canvas.style.cursor = next ? 'grab' : 'default';
    }
  }

  handlePointerUp(event, cancelled) {
    const drag = this.drag;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    this.drag = null;
    if (drag.kind === 'photo') {
      const entry = drag.owner;
      entry.dragging = false;
    if (!drag.moved) {
        drag.object.position.copy(drag.startPosition);
        drag.object.quaternion.copy(drag.startRotation);
        entry.basePosition.copy(drag.startPosition).sub(entry.lastDrift);
        entry.velocity.set(0, 0, 0);
        if (!cancelled && !drag.moved) this.onOpen(entry.id);
      } else {
        entry.basePosition.copy(drag.object.position).sub(entry.lastDrift);
        entry.velocity.copy(drag.velocity);
        entry.userMoved = true;
      }
    } else {
      const piece = drag.owner;
      if (!drag.moved) {
        drag.object.position.copy(drag.startPosition);
        drag.object.quaternion.copy(drag.startRotation);
        if (!cancelled && !drag.moved) this.selectShard(piece);
      } else {
        const snapDistance = this.getPhotoHeight(this.activeCollage.entry.ratio) * .18;
        if (drag.object.position.distanceTo(piece.initialPosition) <= snapDistance) {
          piece.anchorPosition.copy(piece.initialPosition);
          piece.anchorQuaternion.copy(piece.initialQuaternion);
          this.snapShard(piece);
        } else {
          piece.velocity.copy(drag.velocity);
          piece.userMoved = true;
          piece.anchorPosition.copy(drag.object.position);
          piece.anchorQuaternion.copy(drag.object.quaternion);
        }
      }
    }
      this.controls.enabled = this.activeCollage?.phase === 'settled' || !this.activeCollage;
    this.canvas.style.cursor = 'default';
    if (event) event.stopImmediatePropagation();
  }

  handleDoubleClick(event) {
    if (this.activeCollage?.phase !== 'settled') return;
    const pieces = this.activeCollage.shards.map(piece => piece.mesh).filter(mesh => mesh.visible);
    if (this.intersect(event, pieces).length) return;
    this.resetCollageLayout();
  }

  selectShard(piece) {
    if (!this.activeCollage || this.activeCollage.phase !== 'settled') return;
    this.activeCollage.selected = piece;
    for (const shard of this.activeCollage.shards) shard.selected = shard === piece;
  }

  buildCrackLines(entry, polygons) {
    const seen = new Set();
    const positions = [];
    for (const polygon of polygons) {
      for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index], b = polygon[(index + 1) % polygon.length];
        const key = edgeNoiseKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        positions.push((a.x - entry.ratio / 2) * this.getPhotoHeight(entry.ratio), (.5 - a.y) * this.getPhotoHeight(entry.ratio), .014,
          (b.x - entry.ratio / 2) * this.getPhotoHeight(entry.ratio), (.5 - b.y) * this.getPhotoHeight(entry.ratio), .014);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xd6d8d5, transparent: true, opacity: 0, depthWrite: false });
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 3;
    entry.group.add(lines);
    return lines;
  }

  makeShard(entry, polygon, index, random, scatterPosition) {
    const scale = this.getPhotoHeight(entry.ratio);
    const built = createPaperGeometry(polygon, entry.ratio, scale);
    if (!built) return null;
    const grayscaleAmount = { value: 0 };
    const frontMaterial = new THREE.MeshStandardMaterial({ map: entry.texture, roughness: .98, metalness: 0, side: THREE.DoubleSide });
    frontMaterial.userData.etherGrayscale = grayscaleAmount;
    frontMaterial.onBeforeCompile = shader => {
      shader.uniforms.etherGrayscale = grayscaleAmount;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float etherGrayscale;')
        .replace('#include <color_fragment>', `#include <color_fragment>\nfloat etherLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\ndiffuseColor.rgb = mix(vec3(etherLuminance), diffuseColor.rgb, etherGrayscale);`);
    };
    frontMaterial.customProgramCacheKey = () => 'ether-paper-grayscale-v1';
    const materials = [
      frontMaterial,
      new THREE.MeshStandardMaterial({ color: 0xbfc1bd, roughness: 1, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: 0x8d8f8b, roughness: 1, side: THREE.DoubleSide }),
    ];
    const mesh = new THREE.Mesh(built.geometry, materials);
    const localCenter = new THREE.Vector3((built.center.x - entry.ratio / 2), (.5 - built.center.y), 0);
    const worldCenter = entry.group.localToWorld(localCenter);
    const originalRotation = entry.group.quaternion.clone();
    mesh.position.copy(worldCenter);
    mesh.quaternion.copy(originalRotation);
    mesh.userData = { kind: 'piece', piece: null };
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    const initialPosition = mesh.position.clone();
    const initialQuaternion = mesh.quaternion.clone();
    const layoutPosition = entry.group.position.clone().add(scatterPosition);
    const floatPosition = layoutPosition.clone().add(new THREE.Vector3((random() - .5) * .5, (random() - .5) * .5, (random() - .5) * .28));
    const localRot = new THREE.Euler((random() - .5) * .28, (random() - .5) * .32, (random() - .5) * 5.2);
    const layoutQuaternion = initialQuaternion.clone().multiply(new THREE.Quaternion().setFromEuler(localRot));
    const floatQuaternion = initialQuaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(localRot.x * 1.08, localRot.y * 1.08, localRot.z * 1.08)));
    const piece = {
      mesh, materials, initialPosition, initialQuaternion, floatPosition, floatQuaternion,
      layoutPosition, layoutQuaternion, anchorPosition: layoutPosition.clone(), anchorQuaternion: layoutQuaternion.clone(),
      velocity: new THREE.Vector3(), delay: random() * .22, selected: false, hovered: false, userMoved: false,
      placed: false, snapping: false, snapTween: null,
    };
    mesh.userData.piece = piece;
    return piece;
  }

  openCollage(memoryId) {
    const entry = this.photos.get(memoryId);
    if (!entry?.mesh || !entry.texture || this.activeCollage) return false;
    entry.dragging = false;
    entry.velocity.set(0, 0, 0);
    const cameraPosition = this.camera.position.clone();
    const cameraTarget = this.controls.target.clone();
    const cameraDirection = cameraPosition.clone().sub(cameraTarget).normalize();
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const distance = Math.max(aspect < .82 ? 27 : 23.5, cameraPosition.distanceTo(cameraTarget) * .92);
    const target = entry.group.position.clone();
    const cameraEndPosition = target.clone().addScaledVector(cameraDirection, distance);
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const viewWidth = viewHeight * this.camera.aspect;
    const photoScale = this.getPhotoHeight(entry.ratio);
    const spreadX = Math.min(viewWidth * .26, photoScale * entry.ratio * .43);
    const spreadY = Math.min(viewHeight * .25, photoScale * .30);
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    const cameraForward = cameraDirection.clone().negate();
    const random = randomFor(seedFrom(`${memoryId}:pieces`));
    const slots = [];
    const minSpacing = photoScale * .27;
    for (let index = 0; index < 8; index++) {
      let candidate = null;
      for (let attempt = 0; attempt < 160; attempt++) {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random());
        const next = new THREE.Vector3(
          Math.cos(angle) * radius * spreadX,
          Math.sin(angle) * radius * spreadY,
          (random() - .5) * .9,
        );
        if (slots.every(slot => Math.hypot(next.x - slot.x, next.y - slot.y) >= minSpacing)) {
          candidate = next;
          break;
        }
      }
      if (!candidate) {
        const angle = random() * Math.PI * 2;
        candidate = new THREE.Vector3(Math.cos(angle) * spreadX * .8, Math.sin(angle) * spreadY * .8, (random() - .5) * .9);
      }
      slots.push(candidate);
    }
    const polygons = generateVoronoiCells(entry.ratio, seedFrom(memoryId));
    const shards = polygons.map((polygon, index) => {
      const slot = slots[index];
      const worldOffset = cameraRight.clone().multiplyScalar(slot.x)
        .addScaledVector(cameraUp, slot.y)
        .addScaledVector(cameraForward, slot.z);
      return this.makeShard(entry, polygon, index, random, worldOffset);
    }).filter(Boolean);
    if (shards.length < 6) {
      for (const shard of shards) this.disposeShard(shard);
      this.onError(new Error('照片分区未能生成'), entry.memory);
      return false;
    }
    const crackLines = this.buildCrackLines(entry, polygons);
    this.activeCollage = {
      entry, shards, crackLines, phase: 'opening', startedAt: this.time,
      splitAt: null, settledAt: null, selected: null,
      cameraStartPosition: cameraPosition, cameraStartTarget: cameraTarget,
      cameraEndPosition, cameraEndTarget: target,
      restoreCameraPosition: cameraPosition.clone(), restoreCameraTarget: cameraTarget.clone(),
      previousControlsEnabled: true, resetStartedAt: null,
    };
    entry.collage = this.activeCollage;
    entry.mesh.visible = true;
    this.controls.enabled = false;
    this.reportPuzzleProgress();
    return true;
  }

  puzzleStatus() {
    const shards = this.activeCollage?.shards ?? [];
    const placed = shards.filter(piece => piece.placed).length;
    return { placed, total: shards.length, complete: shards.length > 0 && placed === shards.length };
  }

  reportPuzzleProgress() { this.onProgress(this.puzzleStatus()); }

  setShardPlaced(piece, placed) {
    piece.placed = placed;
    const shaderUniform = piece.materials[0].userData.etherGrayscale;
    if (shaderUniform) shaderUniform.value = placed ? 1 : 0;
    this.reportPuzzleProgress();
  }

  snapShard(piece) {
    piece.velocity.set(0, 0, 0);
    piece.snapping = true;
    piece.snapTween = {
      at: this.time,
      duration: this.reducedMotion ? .12 : .48,
      startPosition: piece.mesh.position.clone(),
      startQuaternion: piece.mesh.quaternion.clone(),
    };
  }

  restorePhoto(memoryId) {
    const collage = this.activeCollage;
    if (!collage || collage.entry.id !== memoryId || collage.phase === 'restoring') return;
    this.finishDragForRestore();
    collage.phase = 'restoring';
    collage.restoreAt = this.time;
    collage.restoreDuration = this.reducedMotion ? .16 : 1.45;
    collage.restoreStarts = collage.shards.map(piece => ({ position: piece.mesh.position.clone(), quaternion: piece.mesh.quaternion.clone() }));
    this.controls.enabled = false;
    collage.entry.mesh.visible = false;
    collage.entry.backing.visible = false;
    collage.entry.shadow.visible = false;
    for (const piece of collage.shards) piece.mesh.visible = true;
  }

  finishDragForRestore() {
    if (!this.drag) return;
    const event = { pointerId: this.drag.pointerId, stopImmediatePropagation() {} };
    this.handlePointerUp(event, true);
  }

  resetCollageLayout() {
    const collage = this.activeCollage;
    if (!collage || collage.phase !== 'settled') return;
    collage.phase = 'resetting';
    collage.resetAt = this.time;
    collage.resetDuration = this.reducedMotion ? .12 : .9;
    collage.resetStarts = collage.shards.map(piece => ({ position: piece.mesh.position.clone(), quaternion: piece.mesh.quaternion.clone() }));
    collage.selected = null;
    collage.shards.forEach(piece => {
      piece.selected = false;
      piece.velocity.set(0, 0, 0);
      piece.snapping = false;
      piece.snapTween = null;
      piece.placed = false;
      piece.materials[0].userData.etherGrayscale.value = 0;
    });
    this.reportPuzzleProgress();
    this.controls.enabled = false;
  }

  frame(now) {
    if (this.disposed) return;
    const delta = this.lastFrame ? Math.min(.05, Math.max(0, (now - this.lastFrame) / 1000)) : 0;
    this.lastFrame = now;
    this.time = now / 1000;
    this.updatePhotos(delta);
    this.updateCollage(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  updatePhotos(delta) {
    for (const entry of this.photos.values()) {
      if (!entry.mesh || entry.dragging || entry.collage) continue;
      if (entry.velocity.lengthSq() > .0001) {
        entry.basePosition.addScaledVector(entry.velocity, delta);
        entry.velocity.multiplyScalar(Math.exp(-2.8 * delta));
        if (entry.velocity.lengthSq() < .0001) entry.velocity.set(0, 0, 0);
        entry.userMoved = true;
      }
      const amplitude = entry.floatScale * (this.reducedMotion ? .2 : 1);
      const t = this.time;
      entry.lastDrift.set(
        Math.sin(t * entry.frequencyX + entry.phase) * entry.ampX * amplitude,
        Math.sin(t * entry.frequencyY + entry.phase * 1.31) * entry.ampY * amplitude,
        Math.sin(t * entry.frequencyZ + entry.phase * .77) * entry.ampZ * amplitude,
      );
      entry.group.position.copy(entry.basePosition).add(entry.lastDrift);
      entry.group.rotation.set(
        entry.baseRotation.x + Math.sin(t * .11 + entry.phase) * .018 * amplitude,
        entry.baseRotation.y + Math.sin(t * .09 + entry.phase * 1.7) * .024 * amplitude,
        entry.baseRotation.z + Math.sin(t * .14 + entry.phase) * .042 * amplitude,
      );
      if (!entry.userMoved) entry.basePosition.lerp(entry.layoutTarget, 1 - Math.exp(-.9 * delta));
    }
  }

  updateCollage(delta) {
    const collage = this.activeCollage;
    if (!collage) return;
    const entry = collage.entry;
    if (collage.phase === 'opening') {
      const elapsed = this.time - collage.startedAt;
      const cameraProgress = easeInOut(clamp(elapsed / (this.reducedMotion ? .12 : .62), 0, 1));
      this.camera.position.lerpVectors(collage.cameraStartPosition, collage.cameraEndPosition, cameraProgress);
      this.controls.target.lerpVectors(collage.cameraStartTarget, collage.cameraEndTarget, cameraProgress);
      collage.crackLines.material.opacity = .2 * clamp(elapsed / (this.reducedMotion ? .1 : .46), 0, 1);
      if (elapsed >= (this.reducedMotion ? .14 : .56)) {
        entry.mesh.visible = false;
        entry.backing.visible = false;
        entry.shadow.visible = false;
        collage.crackLines.visible = false;
        for (const piece of collage.shards) piece.mesh.visible = true;
        collage.phase = 'separating';
        collage.splitAt = this.time;
      }
      return;
    }
    if (collage.phase === 'separating') {
      const duration = this.reducedMotion ? .16 : 1.32;
      for (const piece of collage.shards) {
        const elapsed = this.time - collage.splitAt - piece.delay;
        if (elapsed <= 0) continue;
        const progress = clamp(elapsed / duration, 0, 1);
        const amount = easeOut(progress);
        piece.mesh.position.lerpVectors(piece.initialPosition, piece.floatPosition, amount);
        piece.mesh.quaternion.slerpQuaternions(piece.initialQuaternion, piece.floatQuaternion, amount);
      }
      const maxDelay = Math.max(...collage.shards.map(piece => piece.delay));
      if (this.time - collage.splitAt >= maxDelay + duration) {
        collage.phase = 'settling';
        collage.settleAt = this.time;
        collage.settleStarts = collage.shards.map(piece => ({ position: piece.mesh.position.clone(), quaternion: piece.mesh.quaternion.clone() }));
      }
      return;
    }
    if (collage.phase === 'settling') {
      const duration = this.reducedMotion ? .15 : .92;
      const progress = clamp((this.time - collage.settleAt) / duration, 0, 1);
      const amount = easeInOut(progress);
      collage.shards.forEach((piece, index) => {
        const start = collage.settleStarts[index];
        piece.mesh.position.lerpVectors(start.position, piece.layoutPosition, amount);
        piece.mesh.quaternion.slerpQuaternions(start.quaternion, piece.layoutQuaternion, amount);
      });
      if (progress >= 1) {
        collage.shards.forEach(piece => {
          piece.mesh.position.copy(piece.layoutPosition);
          piece.mesh.quaternion.copy(piece.layoutQuaternion);
          piece.anchorPosition.copy(piece.layoutPosition);
          piece.anchorQuaternion.copy(piece.layoutQuaternion);
        });
        collage.phase = 'settled';
        this.controls.enabled = true;
      }
      return;
    }
    if (collage.phase === 'settled') {
      for (const piece of collage.shards) {
        if (this.drag?.owner === piece) continue;
        if (piece.snapTween) {
          const progress = clamp((this.time - piece.snapTween.at) / piece.snapTween.duration, 0, 1);
          const amount = easeInOut(progress);
          piece.mesh.position.lerpVectors(piece.snapTween.startPosition, piece.initialPosition, amount);
          piece.mesh.quaternion.slerpQuaternions(piece.snapTween.startQuaternion, piece.initialQuaternion, amount);
          if (progress >= 1) {
            piece.mesh.position.copy(piece.initialPosition);
            piece.mesh.quaternion.copy(piece.initialQuaternion);
            piece.anchorPosition.copy(piece.initialPosition);
            piece.anchorQuaternion.copy(piece.initialQuaternion);
            piece.snapTween = null;
            piece.snapping = false;
            piece.userMoved = false;
            this.setShardPlaced(piece, true);
          }
          continue;
        }
        if (piece.velocity.lengthSq() > .00015) {
          piece.mesh.position.addScaledVector(piece.velocity, delta);
          piece.velocity.multiplyScalar(Math.exp(-3.2 * delta));
          if (piece.velocity.lengthSq() < .00015) {
            piece.velocity.set(0, 0, 0);
            piece.anchorPosition.copy(piece.mesh.position);
            piece.anchorQuaternion.copy(piece.mesh.quaternion);
          }
          continue;
        }
        const lift = piece.selected ? .34 : 0;
        const hover = piece === this.hovered ? .08 : 0;
        const target = piece.anchorPosition.clone().add(new THREE.Vector3(0, 0, lift + hover));
        piece.mesh.position.lerp(target, 1 - Math.exp(-5.2 * delta));
        piece.mesh.quaternion.slerp(piece.anchorQuaternion, 1 - Math.exp(-4.4 * delta));
        const scale = piece === this.hovered || piece.selected ? 1.012 : 1;
        piece.mesh.scale.lerp(new THREE.Vector3(scale, scale, scale), 1 - Math.exp(-6 * delta));
      }
      return;
    }
    if (collage.phase === 'resetting') {
      const progress = clamp((this.time - collage.resetAt) / collage.resetDuration, 0, 1);
      const amount = easeInOut(progress);
      collage.shards.forEach((piece, index) => {
        const start = collage.resetStarts[index];
        piece.mesh.position.lerpVectors(start.position, piece.layoutPosition, amount);
        piece.mesh.quaternion.slerpQuaternions(start.quaternion, piece.layoutQuaternion, amount);
      });
      if (progress >= 1) {
        collage.shards.forEach(piece => {
          piece.mesh.position.copy(piece.layoutPosition);
          piece.mesh.quaternion.copy(piece.layoutQuaternion);
          piece.anchorPosition.copy(piece.layoutPosition);
          piece.anchorQuaternion.copy(piece.layoutQuaternion);
          piece.userMoved = false;
        });
        collage.phase = 'settled';
        this.controls.enabled = true;
      }
      return;
    }
    if (collage.phase === 'restoring') {
      const progress = clamp((this.time - collage.restoreAt) / collage.restoreDuration, 0, 1);
      const amount = easeInOut(progress);
      collage.shards.forEach((piece, index) => {
        const start = collage.restoreStarts[index];
        piece.mesh.position.lerpVectors(start.position, piece.initialPosition, amount);
        piece.mesh.quaternion.slerpQuaternions(start.quaternion, piece.initialQuaternion, amount);
      });
      this.camera.position.lerpVectors(this.camera.position, collage.restoreCameraPosition, Math.min(1, delta * (this.reducedMotion ? 18 : 2.8)));
      this.controls.target.lerp(collage.restoreCameraTarget, Math.min(1, delta * (this.reducedMotion ? 18 : 2.8)));
      collage.crackLines.material.opacity = Math.max(0, collage.crackLines.material.opacity - delta * .7);
      if (progress >= 1) this.finishRestore(collage);
    }
  }

  finishRestore(collage) {
    const entry = collage.entry;
    for (const piece of collage.shards) this.disposeShard(piece);
    entry.group.remove(collage.crackLines);
    collage.crackLines.geometry.dispose();
    collage.crackLines.material.dispose();
    entry.mesh.visible = true;
    entry.backing.visible = true;
    entry.shadow.visible = true;
    entry.collage = null;
    entry.velocity.set(0, 0, 0);
    entry.basePosition.copy(entry.group.position).sub(entry.lastDrift);
    this.activeCollage = null;
    this.controls.enabled = true;
    this.controls.update();
    this.onRestore(entry.id);
  }

  disposeShard(piece) {
    this.scene.remove(piece.mesh);
    piece.mesh.geometry.dispose();
    for (const material of piece.materials) material.dispose();
  }

  disposeEntry(entry) {
    if (entry.collage) {
      const collage = entry.collage;
      for (const piece of collage.shards) this.disposeShard(piece);
      collage.crackLines.geometry.dispose();
      collage.crackLines.material.dispose();
      entry.group.remove(collage.crackLines);
      this.activeCollage = null;
      this.camera.position.copy(collage.restoreCameraPosition);
      this.controls.target.copy(collage.restoreCameraTarget);
      this.controls.enabled = true;
    }
    this.scene.remove(entry.group);
    entry.group.traverse(object => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material?.dispose());
    });
    entry.texture?.dispose();
    this.photos.delete(entry.id);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('start', this.onCameraStart);
    this.controls.dispose();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown, true);
    this.canvas.removeEventListener('pointermove', this.onPointerMove, true);
    this.canvas.removeEventListener('pointerup', this.onPointerUp, true);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel, true);
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('blur', this.onWindowBlur);
    for (const entry of [...this.photos.values()]) this.disposeEntry(entry);
    this.dust.geometry.dispose();
    this.dust.material.dispose();
    this.renderer.dispose();
  }
}
