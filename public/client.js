import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// --- KHỞI TẠO SCENE THREE.JS ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a); // Màu nền tối

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 15, 15); // Đặt góc nhìn chéo từ trên cao

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Ánh sáng
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// Controls (Dùng chuột xoay, zoom)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Grid nền (lưới)
const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
scene.add(gridHelper);

// Trục tọa độ (Đỏ=X, Xanh lá=Y, Xanh dương=Z)
const axesHelper = new THREE.AxesHelper(2);
scene.add(axesHelper);

// --- QUẢN LÝ ĐỐI TƯỢNG ---
let roomMesh = null;
let anchorsMeshes = [];
let tagMeshes = {};
let anchorsData = []; // Lưu dữ liệu tọa độ

// --- 1. HÀM TẠO PHÒNG (HÌNH HỘP) ---
function createRoom(length, width, height, originType) {
    if (roomMesh) scene.remove(roomMesh);

    // Hình học dây khung (Wireframe) cho dễ nhìn xuyên thấu
    const geometry = new THREE.BoxGeometry(length, height, width); 
    const edges = new THREE.EdgesGeometry(geometry);
    roomMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff00 })); // Viền xanh lá

    // Xử lý Gốc tọa độ (Dời hình hộp sao cho góc 0,0,0 nằm đúng chỗ user chọn)
    // Three.js mặc định tâm hình hộp là (0,0,0). Ta phải dịch chuyển (translate).
    // Mặc định ta coi trục Y là độ cao (Up). X là Dài, Z là Rộng.
    
    // Logic đơn giản: Ta giữ nguyên hệ trục tọa độ thế giới. Ta chỉ dời cái hộp đi chỗ khác.
    // Ví dụ: Nếu chọn "Góc Trái - Dưới", tức là góc đó trùng với (0,0,0).
    // Tâm hộp sẽ nằm tại (L/2, H/2, W/2).
    
    let xOff = length / 2;
    let yOff = height / 2;
    let zOff = width / 2;

    // Tùy chỉnh theo select (Demo đơn giản cho 1 trường hợp chuẩn)
    // Ta set mặc định góc (0,0,0) là góc sàn nhà.
    roomMesh.position.set(xOff, yOff, zOff);

    scene.add(roomMesh);
    
    // Gửi cấu hình lên server lưu
    socket.emit('update_room_config', { length, width, height, originType });
}

// --- 2. XỬ LÝ ANCHOR (TRẠM THU PHÁT) ---
function updateAnchorsDisplay(anchors) {
    // Xóa cũ
    anchorsMeshes.forEach(m => scene.remove(m));
    anchorsMeshes = [];

    anchors.forEach((anc, idx) => {
        // Tạo khối cầu xanh dương đại diện Anchor
        const geo = new THREE.SphereGeometry(0.3, 32, 32);
        const mat = new THREE.MeshStandardMaterial({ color: 0x007bff, roughness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);
        
        mesh.position.set(anc.x, anc.z, anc.y); // LƯU Ý: ThreeJS dùng Y là cao, còn thực tế ta hay gọi Z là cao. 
        // Tuy nhiên ở đây input user nhập: H là cao (Y trong ThreeJS). 
        // Quy ước chuẩn ThreeJS: Y is Up. 
        // Nếu user nhập: x(dài), y(rộng), z(cao).
        // Thì map vào ThreeJS: position.set(x, z, y) -> Không, map là set(x, z, y) nếu y là rộng.
        // Để thống nhất:
        // Input User: X (Dài), Y (Rộng), Z (Cao).
        // ThreeJS: X (Dài), Z (Rộng), Y (Cao).
        mesh.position.set(anc.x, anc.z, anc.y); 

        scene.add(mesh);
        anchorsMeshes.push(mesh);
        
        // Vẽ Label (A1, A2...) - Phần này nâng cao, tạm thời bỏ qua hoặc log console
    });
}

// --- 3. XỬ LÝ TAG (VẬT DI CHUYỂN) ---
function updateTagsDisplay(tags) {
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        
        if (!tagMeshes[id]) {
            // Tạo mới Tag màu đỏ
            const geo = new THREE.SphereGeometry(0.2, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            tagMeshes[id] = mesh;
        }
        
        // Cập nhật vị trí
        // Map tương tự Anchor: User(x,y,z) -> ThreeJS(x, z=cao, y=rộng) 
        // Chỉnh lại map chuẩn: X=X, Y=Cao(ThreeJS), Z=Rộng(ThreeJS)
        // Code Server trả về {x, y, z}. 
        // Quy ước server: Z là độ cao.
        // Quy ước ThreeJS: Y là độ cao.
        tagMeshes[id].position.set(pos.x, pos.z, pos.y); 
    });
}


// --- GIAO DIỆN & SỰ KIỆN ---

// Nút Tạo phòng
document.getElementById('btnInitRoom').addEventListener('click', () => {
    const l = parseFloat(document.getElementById('inpL').value);
    const w = parseFloat(document.getElementById('inpW').value);
    const h = parseFloat(document.getElementById('inpH').value);
    const origin = document.getElementById('originSelect').value;
    createRoom(l, w, h, origin);
});

// Nút Thêm Anchor
document.getElementById('btnAddAnchor').addEventListener('click', () => {
    const x = parseFloat(document.getElementById('ax').value);
    const y = parseFloat(document.getElementById('ay').value); // User nghĩ là rộng
    const z = parseFloat(document.getElementById('az').value); // User nghĩ là cao
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) return alert("Nhập số hợp lệ!");
    
    // Lưu ý: Server đang xử lý theo logic toán học thuần túy (x,y,z).
    // Ta cứ gửi đúng x,y,z lên server.
    anchorsData.push({ id: anchorsData.length, x, y, z });
    socket.emit('set_anchors', anchorsData);
    
    // Reset input
    document.getElementById('ax').value = '';
    document.getElementById('ay').value = '';
    document.getElementById('az').value = '';
});

document.getElementById('btnClearAnchors').addEventListener('click', () => {
    anchorsData = [];
    socket.emit('set_anchors', []);
});


// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    createRoom(cfg.length, cfg.width, cfg.height, cfg.originCorner);
    // Điền lại vào input
    document.getElementById('inpL').value = cfg.length;
    document.getElementById('inpW').value = cfg.width;
    document.getElementById('inpH').value = cfg.height;
});

socket.on('anchors_updated', (data) => {
    anchorsData = data;
    updateAnchorsDisplay(data);
    document.getElementById('status').innerText = `Đã có ${data.length} Anchors. Cần tối thiểu 4.`;
});

socket.on('tags_update', (data) => {
    updateTagsDisplay(data);
});


// --- ANIMATION LOOP (Vòng lặp vẽ hình) ---
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Cần thiết cho damping
    renderer.render(scene, camera);
}
animate();

// Resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
