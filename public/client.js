import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const socket = io();
const $ = (id) => document.getElementById(id);

// ================= SCENE =================
const container = $('scene-container');
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
camera.position.set(28, 38, 48);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(20, 40, 10);
scene.add(sun);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(28, 0, 10);
controls.maxPolarAngle = Math.PI * 0.499;
const grid = new THREE.GridHelper(200, 200, 0x535353, 0x2e2e3e);
grid.position.set(28, -0.02, 10);
scene.add(grid);

// Axis gizmo
const axisContainer = $('axis-container');
const axisScene = new THREE.Scene();
const axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
axisCamera.position.z = 2;
const axisRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
axisContainer.appendChild(axisRenderer.domElement);
axisScene.add(new THREE.AxesHelper(1));

// ================= DỮ LIỆU =================
let layout = null;
let roomConfig = { length: 55.9, width: 20.4, height: 8 };
let racksData = [];
let staticGroup = null;
const rackGroup = new THREE.Group();
scene.add(rackGroup);

// ================= VẬT LIỆU / HÌNH DÙNG CHUNG =================
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, ...o });
const M = {
    post: mat(0x2f6db5), beam: mat(0xe67e22), wood: mat(0xb08850), cargo: mat(0xffffff),
    floor: mat(0x2b2b3d, { side: THREE.DoubleSide }),
    wall: mat(0x8899aa, { transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    green: mat(0x27ae60), dark: mat(0x333333), steel: mat(0x95a5a6)
};
const box = new THREE.BoxGeometry(1, 1, 1);
const CARGO = [0xc8a165, 0xb98b4f, 0xd9b77e, 0xa8c0d8];
const D = new THREE.Object3D();
const strHash = (s) => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
const rnd = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };

function inst(material, count) { const m = new THREE.InstancedMesh(box, material, Math.max(count, 1)); m._i = 0; return m; }
function put(m, x, y, z, sx, sy, sz, color) {
    D.position.set(x, y, z); D.scale.set(sx, sy, sz); D.updateMatrix();
    m.setMatrixAt(m._i, D.matrix);
    if (color !== undefined) m.setColorAt(m._i, new THREE.Color(color));
    m._i++;
}
function mesh(material, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(box, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    return m;
}

// ================= KỆ 4 TẦNG =================
function createRack3D(r) {
    const g = new THREE.Group();
    g.userData = { id: r.id };
    const gap = (r.pitchZ - r.cellZ) / 2;
    const tiers = r.tiers || 4;
    const tierH = r.tierH || 1.5;
    const H = tiers * tierH + 0.3;
    const W = r.cols * r.cellX;
    const seed = strHash(r.id);
    const posts = inst(M.post, (r.cols + 1) * (r.rows + 1));
    const beams = inst(M.beam, (r.rows + 1) * tiers);
    const n = r.cols * r.rows * tiers;
    const base = inst(M.wood, n), cargo = inst(M.cargo, n);

    for (let j = 0; j <= r.rows; j++) {
        const z = j * r.pitchZ - gap;
        for (let c = 0; c <= r.cols; c++) put(posts, c * r.cellX, H / 2, z, 0.08, H, 0.08);
        for (let t = 0; t < tiers; t++) put(beams, W / 2, 0.15 + t * tierH, z, W, 0.1, 0.07);
    }
    for (let j = 0; j < r.rows; j++) for (let c = 0; c < r.cols; c++) for (let t = 0; t < tiers; t++) {
        const k = seed + j * 131 + c * 17 + t * 5;
        if (rnd(k) > 0.8) continue;
        const x = (c + 0.5) * r.cellX, z = j * r.pitchZ + r.cellZ / 2, y = 0.2 + t * tierH;
        put(base, x, y + 0.07, z, r.cellX - 0.06, 0.14, r.cellZ);
        put(cargo, x, y + 0.66, z, r.cellX - 0.16, 1.04, r.cellZ - 0.1, CARGO[Math.floor(rnd(k + 1) * CARGO.length)]);
    }
    [posts, beams, base, cargo].forEach((m) => { m.count = m._i; m.instanceMatrix.needsUpdate = true; g.add(m); });
    g.position.set(r.x, 0, r.z);
    return g;
}

function updateRacks() {
    rackGroup.children.forEach((g) => g.traverse((o) => o.isInstancedMesh && o.dispose()));
    rackGroup.clear();
    racksData.forEach((r) => rackGroup.add(createRack3D(r)));
    renderRackListUI();
}

// ================= PHÒNG, TƯỜNG (ĐÃ XÓA XE NÂNG VÀ THÙNG HÀNG PHỤ) =================
function buildStatic() {
    if (staticGroup) {
        scene.remove(staticGroup);
        staticGroup.traverse((o) => o.geometry && o.geometry !== box && o.geometry.dispose());
    }
    if (!layout) return;
    staticGroup = new THREE.Group();
    const H = roomConfig.height;

    const floorGeo = new THREE.ShapeGeometry(new THREE.Shape(layout.floor.map(([x, z]) => new THREE.Vector2(x, z))));
    floorGeo.rotateX(Math.PI / 2);
    staticGroup.add(new THREE.Mesh(floorGeo, M.floor));

    layout.walls.forEach(([x1, z1, x2, z2]) => {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const w = mesh(M.wall, (x1 + x2) / 2, H / 2, (z1 + z2) / 2, len, H, 0.2);
        w.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        staticGroup.add(w);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(len, H, 0.2)),
            new THREE.LineBasicMaterial({ color: 0xe94560 }));
        e.position.copy(w.position); e.rotation.copy(w.rotation);
        staticGroup.add(e);
    });

    scene.add(staticGroup);
}

// ================= DANH SÁCH KỆ (UI) =================
function renderRackListUI() {
    const list = $('rack-list');
    if (!list) return;
    list.innerHTML = '';
    let cells = 0;
    racksData.forEach((r, i) => {
        const tiers = r.tiers || 4;
        const tierH = r.tierH || 1.5;
        cells += r.cols * r.rows * tiers;
        const item = document.createElement('div');
        item.style.cssText = 'background:var(--bg-dark);padding:8px;margin-bottom:5px;border-radius:4px;font-size:.85em';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
        const title = document.createElement('b');
        title.textContent = `Kệ ${i + 1}: ${r.cols}×${r.rows}×${tiers} tầng`;
        const del = document.createElement('button');
        del.textContent = 'Xóa';
        del.style.cssText = 'background:#dc3545;color:#fff;border:none;border-radius:3px;cursor:pointer;padding:2px 6px';
        del.onclick = () => { racksData = racksData.filter((x) => x.id !== r.id); updateRacks(); socket.emit('set_racks', racksData); };
        head.append(title, del);
        const info = document.createElement('div');
        info.style.cssText = 'color:var(--secondary);margin-top:3px';
        info.textContent = `Cao ${(tiers * tierH).toFixed(1)}m | X:${r.x.toFixed(2)} Z:${r.z.toFixed(2)}`;
        item.append(head, info);
        list.appendChild(item);
    });
    if ($('rack-summary')) $('rack-summary').textContent = `${racksData.length} cụm kệ · ${cells} vị trí pallet`;
}

// ================= KÉO KỆ =================
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPt = new THREE.Vector3(), dragOffset = new THREE.Vector3();
let dragObj = null;
function setRay(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
}
renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !$('chk-drag') || !$('chk-drag').checked) return;
    setRay(e);
    const hit = raycaster.intersectObjects(rackGroup.children, true)[0];
    if (!hit) return;
    let o = hit.object;
    while (o && !(o.userData && o.userData.id)) o = o.parent;
    if (!o || !raycaster.ray.intersectPlane(groundPlane, hitPt)) return;
    dragObj = o;
    dragOffset.copy(o.position).sub(hitPt);
    controls.enabled = false;
}, true);
window.addEventListener('pointermove', (e) => {
    if (!dragObj) return;
    setRay(e);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPt)) return;
    const r = racksData.find((x) => x.id === dragObj.userData.id);
    if (!r) return;
    const snap = (v) => Math.round(v / 0.05) * 0.05;
    const maxX = Math.max(0, roomConfig.length - r.cols * r.cellX);
    const maxZ = Math.max(0, roomConfig.width - r.rows * r.pitchZ);
    r.x = Math.min(maxX, Math.max(0, snap(hitPt.x + dragOffset.x)));
    r.z = Math.min(maxZ, Math.max(0, snap(hitPt.z + dragOffset.z)));
    dragObj.position.set(r.x, 0, r.z);
});
window.addEventListener('pointerup', () => {
    if (!dragObj) return;
    dragObj = null;
    controls.enabled = true;
    socket.emit('set_racks', racksData);
    renderRackListUI();
});

// ================= SỰ KIỆN UI =================
const clamp = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
if ($('inpH')) {
    $('inpH').addEventListener('change', () => {
        const h = clamp(parseFloat($('inpH').value), 3, 30, 8);
        $('inpH').value = h;
        roomConfig = { ...roomConfig, height: h };
        buildStatic();
        socket.emit('update_room_config', roomConfig);
    });
}
if ($('chk-drag')) $('chk-drag').addEventListener('change', (e) => { renderer.domElement.style.cursor = e.target.checked ? 'move' : ''; });
if ($('btn-add-rack')) {
    $('btn-add-rack').addEventListener('click', () => {
        racksData.push({
            id: 'rack-' + Date.now(),
            x: 2, z: 2,
            cols: clamp(parseInt($('rackC').value), 1, 12, 4),
            rows: clamp(parseInt($('rackR').value), 1, 30, 10),
            tiers: clamp(parseInt($('rackT').value), 1, 10, 4),
            tierH: clamp(parseFloat($('rackTH').value), 0.5, 3, 1.5),
            cellX: 1.22, cellZ: 1.17, pitchZ: 1.55
        });
        updateRacks();
        socket.emit('set_racks', racksData);
    });
}
if ($('btn-load-layout')) {
    $('btn-load-layout').addEventListener('click', () => {
        if (!layout) return;
        racksData = JSON.parse(JSON.stringify(layout.racks));
        updateRacks();
        socket.emit('set_racks', racksData);
    });
}

// ================= AI PHÂN TÍCH LAYOUT =================
const btnAi = document.getElementById('btnAiGenerate');
if (btnAi) {
    btnAi.addEventListener('click', async () => {
        const fileInput = document.getElementById('layoutUpload');
        const statusText = document.getElementById('aiStatus');
        
        if (!fileInput || !fileInput.files[0]) {
            alert("Vui lòng chọn ảnh bản vẽ layout kho trước.");
            return;
        }

        if (statusText) statusText.innerText = "⏳ AI đang bóc tách tọa độ...";

        const inpL = $('inpL'), inpW = $('inpW'), inpH = $('inpH');
        const realLength = (inpL && parseFloat(inpL.value)) || roomConfig.length || 55.9;
        const realWidth = (inpW && parseFloat(inpW.value)) || roomConfig.width || 20.4;
        const realHeight = (inpH && parseFloat(inpH.value)) || roomConfig.height || 8;

        const reader = new FileReader();
        reader.readAsDataURL(fileInput.files[0]);
        reader.onload = async () => {
            const base64Image = reader.result;

            try {
                const response = await fetch('/api/analyze-layout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageBase64: base64Image, realWidth, realLength })
                });

                const data = await response.json();
                
                if (data.success) {
                    if (statusText) statusText.innerText = "✅ Phân tích xong!";
                    
                    roomConfig = { length: realLength, width: realWidth, height: realHeight };
                    buildStatic();
                    if (typeof socket !== 'undefined') socket.emit('update_room_config', roomConfig);

                    racksData = data.racks; 
                    updateRacks(); 
                    if (typeof socket !== 'undefined') socket.emit('set_racks', racksData);
                } else {
                    if (statusText) statusText.innerText = "❌ Lỗi AI: " + data.message;
                }
            } catch (err) {
                if (statusText) statusText.innerText = "❌ Lỗi kết nối đến Backend.";
                console.error(err);
            }
        };
    });
}

// ================= SOCKET =================
socket.on('room_config_update', (cfg) => {
    roomConfig = cfg;
    if ($('inpL')) $('inpL').value = cfg.length; 
    if ($('inpW')) $('inpW').value = cfg.width; 
    if ($('inpH')) $('inpH').value = cfg.height;
    buildStatic();
});
socket.on('racks_updated', (data) => { racksData = data; updateRacks(); });

fetch('layout.json').then((r) => r.json()).then((l) => { layout = l; buildStatic(); });

// ================= CAMERA PHÍM W/A/S/D =================
const keys = {};
window.addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
function moveCamera() {
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const v = new THREE.Vector3();
    const s = 0.25;
    if (keys.w) v.addScaledVector(fwd, s);
    if (keys.s) v.addScaledVector(fwd, -s);
    if (keys.d) v.addScaledVector(right, s);
    if (keys.a) v.addScaledVector(right, -s);
    camera.position.add(v); controls.target.add(v);
}

// ================= RENDER LOOP & RESIZE =================
function resize() {
    const { clientWidth: w, clientHeight: h } = viewport;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    axisCamera.aspect = 1; axisCamera.updateProjectionMatrix();
    axisRenderer.setSize(axisContainer.clientWidth, axisContainer.clientHeight);
}
window.addEventListener('resize', resize);
resize();

(function animate() {
    requestAnimationFrame(animate);
    moveCamera();
    controls.update();
    renderer.render(scene, camera);
    axisCamera.quaternion.copy(camera.quaternion);
    axisRenderer.render(axisScene, axisCamera);
})();

// ================= PANEL NỔI =================
document.querySelectorAll('.collapsible').forEach((c) => c.addEventListener('click', () => {
    c.classList.toggle('active');
    const content = c.nextElementSibling;
    content.style.maxHeight = content.style.maxHeight === 'none' ? '0' : 'none';
}));
const panel = $('floating-panel'), header = document.querySelector('.panel-header');
if ($('btn-settings')) $('btn-settings').addEventListener('click', () => { if (panel) panel.style.display = 'flex'; });
if ($('btn-close-panel')) $('btn-close-panel').addEventListener('click', () => { if (panel) panel.style.display = 'none'; });
let dragging = false, sx, sy, ix, iy;
if (header) {
    header.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; dragging = true; sx = e.clientX; sy = e.clientY; ix = panel.offsetLeft; iy = panel.offsetTop; });
    document.addEventListener('mousemove', (e) => { if (dragging && panel) { panel.style.left = ix + e.clientX - sx + 'px'; panel.style.top = iy + e.clientY - sy + 'px'; } });
    document.addEventListener('mouseup', () => { dragging = false; });
}
