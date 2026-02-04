
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// --- SETUP THREE.JS (3D) ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 20, 15); 
camera.lookAt(0, 0, 0);

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

const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
scene.add(gridHelper);
const axesHelper = new THREE.AxesHelper(2);
scene.add(axesHelper);

const anchorGroup = new THREE.Group();
scene.add(anchorGroup);
const tagGroup = new THREE.Group();
scene.add(tagGroup);

// --- SETUP 2D CANVAS ---
const canvas2d = document.getElementById('main-2d-canvas');
const ctx2d = canvas2d.getContext('2d');

// --- VARIABLES ---
let roomMesh = null;
let anchorsData = [];
let tagMeshes = {}; // Dành cho 3D
let tagDataStore = {}; // Lưu tọa độ tags để vẽ 2D
let roomConfig = { length: 10, width: 8, height: 4 };

// --- HÀM LOGIC 3D ---

function createRoom3D(length, width, height) {
    if (roomMesh) scene.remove(roomMesh);
    const geometry = new THREE.BoxGeometry(length, height, width);
    const edges = new THREE.EdgesGeometry(geometry);
    roomMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
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
        tagMeshes[id].position.set(pos.x, pos.z, pos.y);
    });
}

// --- HÀM LOGIC 2D (MỚI) ---

// --- BIẾN TRẠNG THÁI CHO 2D (ZOOM & PAN) ---
let zoomLevel = 1.0;   // Mức zoom hiện tại (1.0 = mặc định)
let panX = 0;          // Dịch chuyển ngang
let panY = 0;          // Dịch chuyển dọc
let isDragging = false;
let startDragX = 0;
let startDragY = 0;

// --- HÀM LOGIC 2D (ĐÃ NÂNG CẤP) ---

function resize2DCanvas() {
    canvas2d.width = window.innerWidth;
    canvas2d.height = window.innerHeight;
    drawMain2DMap();
}

function drawMain2DMap() {
    const w = canvas2d.width;
    const h = canvas2d.height;
    ctx2d.clearRect(0, 0, w, h);

    // 1. Tính toán Tỷ lệ cơ bản (Base Scale) để vừa màn hình
    const padding = 100; 
    const availW = w - padding;
    const availH = h - padding;

    // Scale cơ bản: Pixel / Mét
    const baseScaleX = availW / roomConfig.length;
    const baseScaleY = availH / roomConfig.width;
    const baseScale = Math.min(baseScaleX, baseScaleY); 

    // 2. Tính toán Scale thực tế (Base * Zoom User)
    const currentScale = baseScale * zoomLevel;

    // 3. Tính toán vị trí vẽ (Căn giữa + Pan User)
    const drawW = roomConfig.length * currentScale;
    const drawH = roomConfig.width * currentScale;
    
    // Tọa độ gốc (Top-Left) của hình chữ nhật kho
    const offsetX = (w - drawW) / 2 + panX;
    const offsetY = (h - drawH) / 2 + panY;

    // --- BẮT ĐẦU VẼ ---
    
    ctx2d.save(); // Lưu trạng thái context

    // Vẽ Khung Phòng (Xanh lá)
    ctx2d.strokeStyle = '#00cc00';
    ctx2d.lineWidth = 2; // Độ dày nét không đổi theo zoom cho dễ nhìn
    ctx2d.strokeRect(offsetX, offsetY, drawW, drawH);

    // Vẽ lưới sàn (Grid)
    ctx2d.strokeStyle = '#e0e0e0';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    // Kẻ dọc
    for(let i=1; i<roomConfig.length; i++){
        const x = offsetX + i * currentScale;
        ctx2d.moveTo(x, offsetY);
        ctx2d.lineTo(x, offsetY + drawH);
    }
    // Kẻ ngang
    for(let j=1; j<roomConfig.width; j++){
        const y = offsetY + j * currentScale;
        ctx2d.moveTo(offsetX, y);
        ctx2d.lineTo(offsetX + drawW, y);
    }
    ctx2d.stroke();

    // Vẽ Anchor (Xanh dương)
    ctx2d.fillStyle = '#007bff';
    anchorsData.forEach(anc => {
        const px = offsetX + anc.x * currentScale;
        const py = offsetY + anc.z * currentScale; // Z là trục dọc 2D

        ctx2d.beginPath();
        // Kích thước điểm vẽ cũng nên to lên chút khi zoom, nhưng không quá to
        const radius = Math.max(4, 6 * zoomLevel); 
        ctx2d.arc(px, py, radius, 0, Math.PI * 2);
        ctx2d.fill();
        
        // Label
        if (zoomLevel > 0.5) { // Chỉ hiện chữ khi zoom đủ lớn
            ctx2d.fillStyle = '#000';
            ctx2d.font = `${12 * zoomLevel}px Arial`; // Chữ to theo zoom
            ctx2d.fillText(`A${anc.id !== undefined ? anc.id : ''}`, px + radius + 2, py);
            ctx2d.fillStyle = '#007bff';
        }
    });

    // Vẽ Tag (Đỏ)
    ctx2d.fillStyle = '#ff0000';
    Object.keys(tagDataStore).forEach(id => {
        const pos = tagDataStore[id];
        const px = offsetX + pos.x * currentScale;
        const py = offsetY + pos.z * currentScale;

        ctx2d.beginPath();
        const radius = Math.max(5, 8 * zoomLevel);
        ctx2d.arc(px, py, radius, 0, Math.PI * 2);
        ctx2d.fill();

        // Label Tag
        if (zoomLevel > 0.5) {
            ctx2d.fillStyle = '#000';
            ctx2d.font = `bold ${12 * zoomLevel}px Arial`;
            ctx2d.fillText(id, px + radius + 2, py);
            ctx2d.fillStyle = '#ff0000';
        }
    });

    // Thông tin debug góc màn hình
    ctx2d.fillStyle = '#555';
    ctx2d.font = '12px Arial';
    ctx2d.fillText(`Zoom: ${Math.round(zoomLevel * 100)}%`, 10, h - 10);
    
    ctx2d.restore();
}

// --- XỬ LÝ SỰ KIỆN CHUỘT (ZOOM & PAN) ---

// 1. Zoom bằng lăn chuột
canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scaleAmount = 0.1;
    
    // Zoom in hay out
    if (e.deltaY < 0) {
        zoomLevel += scaleAmount;
    } else {
        zoomLevel = Math.max(0.1, zoomLevel - scaleAmount); // Không cho nhỏ hơn 0.1
    }
    
    drawMain2DMap();
});

// 2. Kéo thả (Pan) - Bắt đầu kéo
canvas2d.addEventListener('mousedown', (e) => {
    isDragging = true;
    startDragX = e.clientX;
    startDragY = e.clientY;
    canvas2d.style.cursor = 'grabbing'; // Đổi con trỏ chuột
});

// 3. Kéo thả - Đang kéo
canvas2d.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startDragX;
    const dy = e.clientY - startDragY;
    
    panX += dx;
    panY += dy;
    
    startDragX = e.clientX;
    startDragY = e.clientY;
    
    drawMain2DMap();
});

// 4. Kéo thả - Kết thúc
canvas2d.addEventListener('mouseup', () => {
    isDragging = false;
    canvas2d.style.cursor = 'default';
});
canvas2d.addEventListener('mouseleave', () => {
    isDragging = false;
    canvas2d.style.cursor = 'default';
});

// --- XỬ LÝ NÚT BẤM TRÊN MÀN HÌNH 2D ---
document.getElementById('btn-2d-in').addEventListener('click', () => {
    zoomLevel += 0.2;
    drawMain2DMap();
});

document.getElementById('btn-2d-out').addEventListener('click', () => {
    zoomLevel = Math.max(0.1, zoomLevel - 0.2);
    drawMain2DMap();
});

document.getElementById('btn-2d-reset').addEventListener('click', () => {
    zoomLevel = 1.0;
    panX = 0;
    panY = 0;
    drawMain2DMap();
});


// --- UI UPDATES ---
function updateTable(tags) {
    const tbody = document.getElementById('tag-table-body');
    if (Object.keys(tags).length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:#999;">Chờ dữ liệu...</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        // Hiển thị tọa độ theo logic người dùng: X, Y, Z (Cao)
        const row = `<tr>
            <td><b>${id}</b></td>
            <td>${pos.x.toFixed(2)}</td>
            <td>${pos.z.toFixed(2)}</td>
            <td>${pos.y.toFixed(2)}</td>
        </tr>`;
        tbody.innerHTML += row;
    });
}


// --- SỰ KIỆN NÚT BẤM ---
document.getElementById('btn-update-room').addEventListener('click', () => {
    const l = parseFloat(document.getElementById('inpL').value) || 10;
    const w = parseFloat(document.getElementById('inpW').value) || 8;
    const h = parseFloat(document.getElementById('inpH').value) || 4;
    createRoom3D(l, w, h);
    socket.emit('update_room_config', { length: l, width: w, height: h });
    drawMain2DMap(); // Vẽ lại 2D nếu đang mở
});

document.getElementById('btn-add-anchor').addEventListener('click', () => {
    const x = parseFloat(document.getElementById('ax').value);
    const y = parseFloat(document.getElementById('ay').value);
    const z = parseFloat(document.getElementById('az').value);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return alert("Nhập số hợp lệ!");
    anchorsData.push({ id: anchorsData.length, x, y, z });
    socket.emit('set_anchors', anchorsData);
    document.getElementById('ax').value = '';
    document.getElementById('ay').value = '';
    document.getElementById('az').value = '';
});

document.getElementById('btn-clear-anchors').addEventListener('click', () => {
    if (confirm("Xóa toàn bộ Anchor?")) {
        anchorsData = [];
        socket.emit('set_anchors', []);
    }
});

document.getElementById('btn-reset-cam').addEventListener('click', () => {
    controls.reset();
    camera.position.set(15, 20, 15);
    camera.lookAt(0,0,0);
});
document.getElementById('btn-top-view').addEventListener('click', () => {
    camera.position.set(roomConfig.length/2, 25, roomConfig.width/2);
    camera.lookAt(roomConfig.length/2, 0, roomConfig.width/2);
});


// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    roomConfig = cfg;
    createRoom3D(cfg.length, cfg.width, cfg.height);
    document.getElementById('inpL').value = cfg.length;
    document.getElementById('inpW').value = cfg.width;
    document.getElementById('inpH').value = cfg.height;
    drawMain2DMap();
});

socket.on('anchors_updated', (data) => {
    anchorsData = data;
    updateAnchors3D(data);
    document.getElementById('anchor-count').innerText = `Anchor: ${data.length}`;
    drawMain2DMap();
});

socket.on('tags_update', (data) => {
    tagDataStore = data; // Lưu dữ liệu để vẽ 2D
    updateTags3D(data);
    updateTable(data);
    
    // Nếu canvas 2D đang hiện (display != none) thì vẽ lại liên tục
    if (canvas2d.offsetParent !== null) {
        drawMain2DMap();
    }
});

// --- ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// Handle Resize
window.addEventListener('resize', () => {
    // Resize 3D
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Resize 2D
    resize2DCanvas();
});

// Init 2D Size on load
resize2DCanvas();
