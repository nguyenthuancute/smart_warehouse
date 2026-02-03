import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// --- SETUP THREE.JS ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 20, 15); 
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Ánh sáng
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Grid & Axes
const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
scene.add(gridHelper);
const axesHelper = new THREE.AxesHelper(2);
scene.add(axesHelper); // Đỏ=X, Xanh lá=Y(Cao), Xanh dương=Z

// Groups
const anchorGroup = new THREE.Group();
scene.add(anchorGroup);
const tagGroup = new THREE.Group();
scene.add(tagGroup);

// Biến dữ liệu
let roomMesh = null;
let anchorsData = [];
let tagMeshes = {};
let roomConfig = { length: 10, width: 8, height: 4 }; // Mặc định

// Canvas Overview
const ovCanvas = document.getElementById('overview-canvas');
const ovCtx = ovCanvas.getContext('2d');

// --- HÀM VẼ 3D ---

function createRoom(length, width, height) {
    if (roomMesh) scene.remove(roomMesh);
    // ThreeJS: Box(x, y=Cao, z)
    // Map từ Input: Length->x, Height->y, Width->z
    const geometry = new THREE.BoxGeometry(length, height, width);
    const edges = new THREE.EdgesGeometry(geometry);
    roomMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    
    // Đặt gốc tọa độ (0,0,0) tại góc trái dưới sàn nhà
    // BoxGeometry tâm ở giữa, nên phải dịch chuyển nửa kích thước
    roomMesh.position.set(length/2, height/2, width/2);
    
    scene.add(roomMesh);
    roomConfig = { length, width, height };
}

function updateAnchors3D(anchors) {
    while(anchorGroup.children.length > 0) anchorGroup.remove(anchorGroup.children[0]);
    anchors.forEach(anc => {
        const geo = new THREE.SphereGeometry(0.15, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x007bff });
        const mesh = new THREE.Mesh(geo, mat);
        // Map: User(x, y, z) -> ThreeJS(x, z, y)
        // User nhập: x(dài), y(rộng), z(cao)
        // ThreeJS: x(dài), y(cao), z(rộng)
        mesh.position.set(anc.x, anc.z, anc.y); 
        anchorGroup.add(mesh);
    });
}

function updateTags3D(tags) {
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        if (!tagMeshes[id]) {
            const geo = new THREE.SphereGeometry(0.2, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            tagMeshes[id] = mesh;
        }
        // Map tương tự anchor: x->x, z->y(ThreeJS), y->z(ThreeJS)
        tagMeshes[id].position.set(pos.x, pos.z, pos.y);
    });
}

// --- HÀM UI ---

// Vẽ bản đồ 2D (Overview)
function drawOverview(tags) {
    const w = ovCanvas.width;
    const h = ovCanvas.height;
    ovCtx.clearRect(0, 0, w, h);
    
    // Tự động scale để vừa khung
    const padding = 20;
    const scaleX = (w - padding*2) / roomConfig.length;
    const scaleY = (h - padding*2) / roomConfig.width;
    const scale = Math.min(scaleX, scaleY);
    
    // Vẽ khung kho
    ovCtx.strokeStyle = '#00aa00';
    ovCtx.lineWidth = 2;
    ovCtx.strokeRect(padding, padding, roomConfig.length * scale, roomConfig.width * scale);
    
    // Vẽ Anchor (Xanh)
    ovCtx.fillStyle = '#007bff';
    anchorsData.forEach(anc => {
        ovCtx.beginPath();
        // 2D View là mặt phẳng XY (Dài x Rộng)
        ovCtx.arc(padding + anc.x*scale, padding + anc.y*scale, 3, 0, Math.PI*2);
        ovCtx.fill();
    });

    // Vẽ Tag (Đỏ)
    ovCtx.fillStyle = '#ff0000';
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        ovCtx.beginPath();
        ovCtx.arc(padding + pos.x*scale, padding + pos.y*scale, 4, 0, Math.PI*2);
        ovCtx.fill();
    });
}

// Cập nhật bảng tọa độ (m)
function updateTable(tags) {
    const tbody = document.getElementById('tag-table-body');
    if (Object.keys(tags).length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:#999;">Chưa có dữ liệu tag...</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        const row = `<tr>
            <td><b>${id}</b></td>
            <td>${pos.x.toFixed(2)}</td>
            <td>${pos.y.toFixed(2)}</td> 
            <td>${pos.z.toFixed(2)}</td>
        </tr>`; // Lưu ý: Ở đây hiển thị đúng logic User (x,y,z)
        tbody.innerHTML += row;
    });
}

// --- SỰ KIỆN NÚT BẤM (GẮN VÀO GIAO DIỆN MỚI) ---

// 1. Cập nhật kích thước kho
document.getElementById('btn-update-room').addEventListener('click', () => {
    const l = parseFloat(document.getElementById('inpL').value) || 10;
    const w = parseFloat(document.getElementById('inpW').value) || 8;
    const h = parseFloat(document.getElementById('inpH').value) || 4;
    
    createRoom(l, w, h);
    socket.emit('update_room_config', { length: l, width: w, height: h });
});

// 2. Thêm Anchor
document.getElementById('btn-add-anchor').addEventListener('click', () => {
    const x = parseFloat(document.getElementById('ax').value);
    const y = parseFloat(document.getElementById('ay').value);
    const z = parseFloat(document.getElementById('az').value);
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) return alert("Vui lòng nhập số hợp lệ!");
    
    anchorsData.push({ id: anchorsData.length, x, y, z });
    socket.emit('set_anchors', anchorsData);
    
    // Clear input
    document.getElementById('ax').value = '';
    document.getElementById('ay').value = '';
    document.getElementById('az').value = '';
});

// 3. Xóa Anchor
document.getElementById('btn-clear-anchors').addEventListener('click', () => {
    if (confirm("Xóa toàn bộ Anchor?")) {
        anchorsData = [];
        socket.emit('set_anchors', []);
    }
});

// 4. Camera Controls
document.getElementById('btn-reset-cam').addEventListener('click', () => {
    controls.reset();
    camera.position.set(15, 20, 15);
    camera.lookAt(0,0,0);
});
document.getElementById('btn-top-view').addEventListener('click', () => {
    camera.position.set(roomConfig.length/2, 25, roomConfig.width/2); // Nhìn thẳng từ giữa kho xuống
    camera.lookAt(roomConfig.length/2, 0, roomConfig.width/2);
});


// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    roomConfig = cfg;
    createRoom(cfg.length, cfg.width, cfg.height);
    // Điền lại vào ô input
    document.getElementById('inpL').value = cfg.length;
    document.getElementById('inpW').value = cfg.width;
    document.getElementById('inpH').value = cfg.height;
    drawOverview({});
});

socket.on('anchors_updated', (data) => {
    anchorsData = data;
    updateAnchors3D(data);
    document.getElementById('anchor-count').innerText = `Anchor: ${data.length}`;
    drawOverview({});
});

socket.on('tags_update', (data) => {
    updateTags3D(data);
    updateTable(data);
    drawOverview(data);
});

// --- ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
