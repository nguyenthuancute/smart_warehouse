import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();

// --- KHỞI TẠO SCENE ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(10, 10, 10);

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

// --- QUẢN LÝ ĐỐI TƯỢNG ---
let roomMesh = null;
let tagMeshes = {};
let anchorsData = [];

// TẠO GROUP CHO ANCHOR (ĐỂ DỄ ẨN/HIỆN TOÀN BỘ)
const anchorGroup = new THREE.Group();
scene.add(anchorGroup);

// 1. HÀM TẠO PHÒNG
function createRoom(length, width, height, originType) {
    if (roomMesh) scene.remove(roomMesh);

    const geometry = new THREE.BoxGeometry(length, height, width);
    const edges = new THREE.EdgesGeometry(geometry);
    roomMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ff00 }));

    // Xử lý vị trí tương đối để gốc tọa độ nằm đúng góc sàn
    // Mặc định BoxGeometry tâm ở (0,0,0).
    // Y là chiều cao.
    
    let xPos = length / 2;
    let yPos = height / 2;
    let zPos = width / 2;

    // Logic đơn giản: Dịch chuyển cái hộp sao cho góc được chọn nằm tại (0,0,0) của thế giới
    switch (originType) {
        case 'bl_floor': // Trái Dưới (Gốc mặc định hay dùng)
            roomMesh.position.set(xPos, yPos, zPos);
            break;
        case 'br_floor': // Phải Dưới
            roomMesh.position.set(-xPos, yPos, zPos);
            break;
        case 'tl_floor': // Trái Trên
            roomMesh.position.set(xPos, yPos, -zPos);
            break;
        case 'tr_floor': // Phải Trên
            roomMesh.position.set(-xPos, yPos, -zPos);
            break;
        default:
            roomMesh.position.set(xPos, yPos, zPos);
    }

    scene.add(roomMesh);
    socket.emit('update_room_config', { length, width, height, originType });
}

// 2. CẬP NHẬT ANCHOR (ĐÃ CHỈNH SỬA)
function updateAnchorsDisplay(anchors) {
    // Xóa hết các mesh con trong group
    while(anchorGroup.children.length > 0){ 
        anchorGroup.remove(anchorGroup.children[0]); 
    }

    anchors.forEach((anc, idx) => {
        // --- CHỈNH SỬA: Bán kính nhỏ lại (0.08) ---
        const geo = new THREE.SphereGeometry(0.08, 16, 16); 
        const mat = new THREE.MeshStandardMaterial({ color: 0x007bff, roughness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);
        
        // Map tọa độ: User(x, y=rộng, z=cao) -> ThreeJS(x, z, y)
        mesh.position.set(anc.x, anc.z, anc.y); 

        // Thêm vào Group thay vì thêm trực tiếp vào Scene
        anchorGroup.add(mesh);
    });
}

// 3. CẬP NHẬT TAG
function updateTagsDisplay(tags) {
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        if (!tagMeshes[id]) {
            const geo = new THREE.SphereGeometry(0.15, 32, 32); // Tag to hơn Anchor chút cho dễ nhìn
            const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 });
            const mesh = new THREE.Mesh(geo, mat);
            scene.add(mesh);
            tagMeshes[id] = mesh;
        }
        tagMeshes[id].position.set(pos.x, pos.z, pos.y);
    });
}

// --- SỰ KIỆN NÚT BẤM ---

document.getElementById('btnInitRoom').addEventListener('click', () => {
    const l = parseFloat(document.getElementById('inpL').value);
    const w = parseFloat(document.getElementById('inpW').value);
    const h = parseFloat(document.getElementById('inpH').value);
    const origin = document.getElementById('originSelect').value;
    createRoom(l, w, h, origin);
});

document.getElementById('btnAddAnchor').addEventListener('click', () => {
    const x = parseFloat(document.getElementById('ax').value);
    const y = parseFloat(document.getElementById('ay').value);
    const z = parseFloat(document.getElementById('az').value);
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) return alert("Nhập số hợp lệ!");
    
    anchorsData.push({ id: anchorsData.length, x, y, z });
    socket.emit('set_anchors', anchorsData);
    
    // Nếu đang ở chế độ ẩn thì hiện lại để người dùng thấy mình vừa thêm gì
    anchorGroup.visible = true;
    document.getElementById('btnShowAnchors').style.display = 'none';
    document.getElementById('btnHideAnchors').style.display = 'inline-block';
});

// --- TÍNH NĂNG MỚI: ẨN/HIỆN ANCHOR ---
document.getElementById('btnHideAnchors').addEventListener('click', () => {
    anchorGroup.visible = false; // Ẩn cả nhóm
    document.getElementById('btnHideAnchors').style.display = 'none';
    document.getElementById('btnShowAnchors').style.display = 'inline-block';
});

document.getElementById('btnShowAnchors').addEventListener('click', () => {
    anchorGroup.visible = true; // Hiện lại cả nhóm
    document.getElementById('btnShowAnchors').style.display = 'none';
    document.getElementById('btnHideAnchors').style.display = 'inline-block';
});

document.getElementById('btnClearAnchors').addEventListener('click', () => {
    if(confirm("Xóa tất cả Anchor?")) {
        anchorsData = [];
        socket.emit('set_anchors', []);
    }
});

// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    createRoom(cfg.length, cfg.width, cfg.height, cfg.originCorner);
});

socket.on('anchors_updated', (data) => {
    anchorsData = data;
    updateAnchorsDisplay(data);
    document.getElementById('status').innerText = `Anchor: ${data.length} (Cần >3)`;
});

socket.on('tags_update', (data) => {
    updateTagsDisplay(data);
});

// --- ANIMATION ---
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
