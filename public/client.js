import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// --- SETUP THREE.JS (Giữ nguyên) ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// Camera góc nhìn chim bay (Bird's eye view)
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 0); // Đặt camera ở trên cao
camera.lookAt(0, 0, 0); // Nhìn xuống gốc tọa độ

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// controls.maxPolarAngle = Math.PI / 2; // Giới hạn không cho camera quay xuống dưới mặt sàn

const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
scene.add(gridHelper);
const axesHelper = new THREE.AxesHelper(2);
scene.add(axesHelper);

const anchorGroup = new THREE.Group();
scene.add(anchorGroup);
const tagGroup = new THREE.Group();
scene.add(tagGroup);

let roomMesh = null;
let anchorsData = [];
let tagMeshes = {};
let tagPositionsData = {}; // Lưu dữ liệu vị trí tag
let roomConfigData = null; // Lưu cấu hình phòng

// --- SETUP OVERVIEW CANVAS (Bản đồ thu nhỏ) ---
const overviewCanvas = document.getElementById('overview-canvas');
const overviewCtx = overviewCanvas.getContext('2d');

// --- HÀM XỬ LÝ 3D (Giữ nguyên logic) ---

function createRoom(length, width, height, originType) {
    if (roomMesh) scene.remove(roomMesh);
    const geometry = new THREE.BoxGeometry(length, height, width);
    const edges = new THREE.EdgesGeometry(geometry);
    roomMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff00 }));

    let xOff = length / 2;
    let yOff = height / 2;
    let zOff = width / 2;

    switch (originType) {
        case 'bl_floor': roomMesh.position.set(xOff, yOff, zOff); break;
        case 'br_floor': roomMesh.position.set(-xOff, yOff, zOff); break;
        case 'tl_floor': roomMesh.position.set(xOff, yOff, -zOff); break;
        case 'tr_floor': roomMesh.position.set(-xOff, yOff, -zOff); break;
        default: roomMesh.position.set(xOff, yOff, zOff);
    }
    scene.add(roomMesh);
}

function updateAnchors(anchors) {
    while(anchorGroup.children.length > 0) anchorGroup.remove(anchorGroup.children[0]);
    anchors.forEach(anc => {
        const geo = new THREE.SphereGeometry(0.1, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x007bff });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(anc.x, anc.z, anc.y); 
        anchorGroup.add(mesh);
    });
}

function updateTags(tags) {
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        if (!tagMeshes[id]) {
            const geo = new THREE.SphereGeometry(0.15, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            tagMeshes[id] = mesh;
        }
        tagMeshes[id].position.set(pos.x, pos.z, pos.y);
    });
}

// --- HÀM XỬ LÝ GIAO DIỆN MỚI ---

// 1. Vẽ bản đồ thu nhỏ (Overview 2D - Mặt phẳng XZ)
function drawOverviewMap() {
    if (!roomConfigData) return;
    const width = overviewCanvas.width;
    const height = overviewCanvas.height;
    overviewCtx.clearRect(0, 0, width, height);

    // Tính tỷ lệ vẽ
    const margin = 20;
    const drawWidth = width - margin * 2;
    const drawHeight = height - margin * 2;
    
    const scaleX = drawWidth / roomConfigData.length;
    const scaleZ = drawHeight / roomConfigData.width;
    const scale = Math.min(scaleX, scaleZ);

    // Tọa độ bắt đầu vẽ (để căn giữa)
    const startX = (width - roomConfigData.length * scale) / 2;
    const startY = (height - roomConfigData.width * scale) / 2;

    // Vẽ khung kho
    overviewCtx.strokeStyle = '#00ff00';
    overviewCtx.lineWidth = 2;
    overviewCtx.strokeRect(startX, startY, roomConfigData.length * scale, roomConfigData.width * scale);

    // Vẽ Anchors (Xanh dương)
    anchorsData.forEach(anc => {
        const x = startX + anc.x * scale;
        const y = startY + anc.z * scale; // Dùng Z cho trục dọc của bản đồ 2D
        overviewCtx.fillStyle = '#007bff';
        overviewCtx.beginPath();
        overviewCtx.arc(x, y, 3, 0, Math.PI * 2);
        overviewCtx.fill();
    });

    // Vẽ Tags (Đỏ)
    Object.keys(tagPositionsData).forEach(id => {
        const pos = tagPositionsData[id];
        const x = startX + pos.x * scale;
        const y = startY + pos.z * scale;
        overviewCtx.fillStyle = '#ff0000';
        overviewCtx.beginPath();
        overviewCtx.arc(x, y, 4, 0, Math.PI * 2);
        overviewCtx.fill();
    });
}

// 2. Cập nhật bảng tọa độ Tag
function updateTagTable(tags) {
    const tbody = document.querySelector('#tag-positions-table tbody');
    if (Object.keys(tags).length === 0) {
        tbody.innerHTML = '<tr class="tag-row-empty"><td colspan="4">Chưa có dữ liệu tag...</td></tr>';
        return;
    }
    tbody.innerHTML = ''; // Xóa dữ liệu cũ
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        const row = tbody.insertRow();
        row.insertCell().textContent = id;
        row.insertCell().textContent = pos.x.toFixed(2);
        row.insertCell().textContent = pos.z.toFixed(2); // Z là độ cao (Y trong ThreeJS)
        row.insertCell().textContent = pos.y.toFixed(2); // Y là chiều rộng (Z trong ThreeJS)
    });
}

// --- SỰ KIỆN NÚT BẤM (LỊCH SỬ) ---
document.getElementById('btn-history-start').addEventListener('click', () => {
    alert("Chức năng 'Bắt đầu ghi' đang được phát triển!");
});
document.getElementById('btn-history-end').addEventListener('click', () => {
    alert("Chức năng 'Kết thúc ghi' đang được phát triển!");
});
document.getElementById('btn-history-replay').addEventListener('click', () => {
    alert("Chức năng 'Xem lại' đang được phát triển!");
});

// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    roomConfigData = cfg;
    createRoom(cfg.length, cfg.width, cfg.height, cfg.originType);
    drawOverviewMap(); // Vẽ lại overview
});

socket.on('anchors_updated', (data) => {
    anchorsData = data;
    updateAnchors(data);
    drawOverviewMap(); // Vẽ lại overview
    document.getElementById('status').innerText = `Anchor: ${data.length}`;
});

socket.on('tags_update', (data) => {
    tagPositionsData = data;
    updateTags(data);
    updateTagTable(data); // Cập nhật bảng
    drawOverviewMap(); // Vẽ lại overview
});

// --- LOOP ---
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
