import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js'; // Import công cụ kéo thả

const socket = io();

// --- SETUP THREE.JS (3D) ---
const container = document.getElementById('scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.set(15, 20, 15);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const gridHelper = new THREE.GridHelper(1000, 100, 0x535353, 0x3a3a3a);
scene.add(gridHelper);

// --- AXIS GIZMO ---
const axisContainer = document.getElementById('axis-container');
const axisScene = new THREE.Scene();
const axisCamera = new THREE.PerspectiveCamera(50, axisContainer.clientWidth / axisContainer.clientHeight, 0.1, 10);
axisCamera.position.z = 2;
const axisRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
axisRenderer.setSize(axisContainer.clientWidth, axisContainer.clientHeight);
axisContainer.appendChild(axisRenderer.domElement);

const axisHelper = new THREE.AxesHelper(1);
axisScene.add(axisHelper);

let roomMesh = null;
let roomConfig = { length: 10, width: 8, height: 4 };

// --- RACKS (KỆ HÀNG) & DRAG CONTROLS ---
let racksData = []; 
const rackGroup = new THREE.Group(); 
scene.add(rackGroup);

let dragControls;
let rackMeshes = []; // Mảng chứa các mesh kệ để DragControls nhận diện

function createRack3D(rack) {
    const group = new THREE.Group();
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xe67e22 }); // Màu cam cho mặt kệ
    const postMat = new THREE.MeshStandardMaterial({ color: 0x34495e }); // Màu xám đậm cho cột trụ

    const tierSpacing = rack.h / rack.tiers;
    const shelfThickness = 0.05;
    const postThickness = 0.1;

    // 1. Tạo các tầng (mặt sàn kệ)
    for (let i = 0; i < rack.tiers; i++) {
        const shelfGeo = new THREE.BoxGeometry(rack.l, shelfThickness, rack.w);
        const shelf = new THREE.Mesh(shelfGeo, shelfMat);
        shelf.position.y = (i * tierSpacing) + (shelfThickness / 2) + 0.1; 
        group.add(shelf);
    }

    // 2. Tạo 4 cột trụ
    const postGeo = new THREE.BoxGeometry(postThickness, rack.h, postThickness);
    const postPositions = [
        [-rack.l/2 + postThickness/2, rack.w/2 - postThickness/2], // Góc trái trên
        [rack.l/2 - postThickness/2, rack.w/2 - postThickness/2],  // Góc phải trên
        [-rack.l/2 + postThickness/2, -rack.w/2 + postThickness/2], // Góc trái dưới
        [rack.l/2 - postThickness/2, -rack.w/2 + postThickness/2]   // Góc phải dưới
    ];

    postPositions.forEach(pos => {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(pos[0], rack.h / 2, pos[1]);
        group.add(post);
    });

    group.position.set(rack.x, 0, rack.z);
    group.userData = { id: rack.id }; // Lưu ID để xác định lúc kéo thả
    return group;
}

function updateRacks() {
    // Xóa cụm kệ cũ trên Scene
    while (rackGroup.children.length > 0) {
        rackGroup.remove(rackGroup.children[0]);
    }
    rackMeshes = [];

    // Vẽ kệ mới
    racksData.forEach(rack => {
        const rackMesh = createRack3D(rack);
        rackGroup.add(rackMesh);
        rackMeshes.push(rackMesh);
    });

    // Reset công cụ DragControls
    if (dragControls) dragControls.dispose(); 
    dragControls = new DragControls(rackMeshes, camera, renderer.domElement);
    dragControls.transformGroup = true; // Kéo toàn bộ cụm Group thay vì từng thanh gỗ nhỏ

    dragControls.addEventListener('dragstart', function (event) {
        controls.enabled = false; // Tắt tính năng xoay camera khi đang kéo kệ
        event.object.children.forEach(child => {
            if(child.material.emissive) child.material.emissive.set(0x333333); // Sáng lên khi được chọn
        });
    });

    dragControls.addEventListener('drag', function (event) {
        event.object.position.y = 0; // Giữ kệ luôn nằm sát mặt đất (khóa trục Y)
        
        // Lưu vị trí đang kéo vào mảng Data tạm
        const index = racksData.findIndex(r => r.id === event.object.userData.id);
        if(index !== -1) {
            racksData[index].x = event.object.position.x;
            racksData[index].z = event.object.position.z;
        }
    });

    dragControls.addEventListener('dragend', function (event) {
        controls.enabled = true; // Bật lại xoay camera
        event.object.children.forEach(child => {
            if(child.material.emissive) child.material.emissive.set(0x000000); // Tắt sáng
        });
        
        // Gửi tọa độ mới lên Server và cập nhật UI
        socket.emit('set_racks', racksData); 
        renderRackListUI(); 
    });

    renderRackListUI();
}

// --- 3D ROOM LOGIC ---
function createRoom3D(length, width, height) {
    if (roomMesh) scene.remove(roomMesh);
    const geometry = new THREE.BoxGeometry(length, height, width);
    const material = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide
    });
    roomMesh = new THREE.Mesh(geometry, material);

    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe94560 });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    roomMesh.add(wireframe);

    roomMesh.position.set(length / 2, height / 2, width / 2);
    scene.add(roomMesh);
    roomConfig = { length, width, height };
}

// --- KEYBOARD CONTROLS (Camera) ---
const keyStates = {};
window.addEventListener('keydown', (event) => { keyStates[event.key.toLowerCase()] = true; });
window.addEventListener('keyup', (event) => { keyStates[event.key.toLowerCase()] = false; });

function updateCameraMovement() {
    const moveSpeed = 5.0;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const forwardOnPlane = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, forward).normalize();

    if (keyStates['w']) {
        const moveVector = forwardOnPlane.clone().multiplyScalar(moveSpeed * 0.1);
        camera.position.add(moveVector);
        controls.target.add(moveVector);
    }
    if (keyStates['s']) {
        const moveVector = forwardOnPlane.clone().multiplyScalar(moveSpeed * 0.1);
        camera.position.sub(moveVector);
        controls.target.sub(moveVector);
    }
    if (keyStates['d']) {
        const moveVector = right.clone().multiplyScalar(moveSpeed * 0.1);
        camera.position.sub(moveVector);
        controls.target.sub(moveVector);
    }
    if (keyStates['a']) {
        const moveVector = right.clone().multiplyScalar(moveSpeed * 0.1);
        camera.position.add(moveVector);
        controls.target.add(moveVector);
    }
}

// --- GIAO DIỆN UI ---
document.getElementById('inpL').addEventListener('change', updateRoom);
document.getElementById('inpW').addEventListener('change', updateRoom);
document.getElementById('inpH').addEventListener('change', updateRoom);

function updateRoom() {
    const l = parseFloat(document.getElementById('inpL').value) || 10;
    const w = parseFloat(document.getElementById('inpW').value) || 8;
    const h = parseFloat(document.getElementById('inpH').value) || 4;
    createRoom3D(l, w, h);
    socket.emit('update_room_config', { length: l, width: w, height: h });
}

// Giao diện Thêm kệ hàng
const btnAddRack = document.getElementById('btn-add-rack');
if(btnAddRack) {
    btnAddRack.addEventListener('click', () => {
        const l = parseFloat(document.getElementById('rackL').value) || 2;
        const w = parseFloat(document.getElementById('rackW').value) || 1;
        const h = parseFloat(document.getElementById('rackH').value) || 3;
        const tiers = parseInt(document.getElementById('rackTiers').value) || 4;

        const newRack = {
            id: Date.now().toString(),
            l, w, h, tiers,
            x: roomConfig.length / 2, 
            z: roomConfig.width / 2
        };

        racksData.push(newRack);
        updateRacks();
        socket.emit('set_racks', racksData);
        
        // Tự động kéo dài khung collapsible
        const content = document.querySelector('#racks-section .collapsible-content');
        if(content && content.style.maxHeight) {
            content.style.maxHeight = content.scrollHeight + "px";
        }
    });
}

function renderRackListUI() {
    const rackListEl = document.getElementById('rack-list');
    if(!rackListEl) return;
    
    rackListEl.innerHTML = '';
    racksData.forEach((rack, index) => {
        const item = document.createElement('div');
        item.style.cssText = "background: var(--bg-dark); padding: 8px; margin-bottom: 5px; border-radius: 4px; font-size: 0.85em;";
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <b>Kệ ${index + 1} (${rack.tiers} tầng)</b>
                <button class="btn-remove-rack" data-id="${rack.id}" style="background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 6px;">Xóa</button>
            </div>
            <div style="color: var(--secondary); margin-top: 3px;">
                KT: ${rack.l}x${rack.w}x${rack.h} | Tọa độ: X:${rack.x.toFixed(1)}, Z:${rack.z.toFixed(1)}
            </div>
        `;
        rackListEl.appendChild(item);
    });

    document.querySelectorAll('.btn-remove-rack').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            racksData = racksData.filter(r => r.id !== id);
            updateRacks();
            socket.emit('set_racks', racksData);
        });
    });
}

// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    roomConfig = cfg;
    createRoom3D(cfg.length, cfg.width, cfg.height);
    document.getElementById('inpL').value = cfg.length;
    document.getElementById('inpW').value = cfg.width;
    document.getElementById('inpH').value = cfg.height;
});

socket.on('racks_updated', (data) => {
    racksData = data;
    updateRacks();
});

// --- ANIMATION LOOP & RESIZE ---
function animate() {
    requestAnimationFrame(animate);
    updateCameraMovement();
    controls.update();
    renderer.render(scene, camera);
    axisCamera.quaternion.copy(camera.quaternion);
    axisRenderer.render(axisScene, axisCamera);
}
animate();

const viewport = document.getElementById('viewport');
window.addEventListener('resize', () => {
    const { clientWidth, clientHeight } = viewport;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);

    axisCamera.aspect = axisContainer.clientWidth / axisContainer.clientHeight;
    axisCamera.updateProjectionMatrix();
    axisRenderer.setSize(axisContainer.clientWidth, axisContainer.clientHeight);
});

// Initial setup
createRoom3D(roomConfig.length, roomConfig.width, roomConfig.height);
window.dispatchEvent(new Event('resize'));

// --- BẢNG ĐIỀU KHIỂN & FLOATING PANEL ---
const collapsibles = document.querySelectorAll('.collapsible');
collapsibles.forEach(coll => {
    coll.addEventListener('click', () => {
        coll.classList.toggle('active');
        const content = coll.nextElementSibling;
        if (content.style.maxHeight && content.style.maxHeight !== 'fit-content') {
            content.style.maxHeight = null;
        } else {
            content.style.maxHeight = content.scrollHeight + "px";
        }
    });
});

const settingsBtn = document.getElementById('btn-settings');
const closePanelBtn = document.getElementById('btn-close-panel');
const floatingPanel = document.getElementById('floating-panel');
const panelHeader = document.querySelector('.panel-header');

settingsBtn.addEventListener('click', () => {
    floatingPanel.style.display = 'flex';
});

closePanelBtn.addEventListener('click', () => {
    floatingPanel.style.display = 'none';
});

let isDragging = false;
let startX, startY, initialX, initialY;

panelHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialX = floatingPanel.offsetLeft;
    initialY = floatingPanel.offsetTop;
    panelHeader.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    floatingPanel.style.left = (initialX + dx) + 'px';
    floatingPanel.style.top = (initialY + dy) + 'px';
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    panelHeader.style.cursor = 'grab';
});
