
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
const axesHelper = new THREE.AxesHelper(5); // FIXED: Increased size
scene.add(axesHelper);

const anchorGroup = new THREE.Group();
scene.add(anchorGroup);
const tagGroup = new THREE.Group();
scene.add(tagGroup);

const canvas2d = document.getElementById('main-2d-canvas');
const ctx2d = canvas2d.getContext('2d');

let roomMesh = null;
let anchorsData = [];
let tagMeshes = {};
let tagDataStore = {};
let tagInterpolation = {};
let roomConfig = { length: 10, width: 8, height: 4 };

// --- 3D LOGIC ---
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
        mesh.position.set(anc.x, anc.y, anc.z); 
        anchorGroup.add(mesh);
    });
}

function updateTags3D(tags) {
    Object.keys(tags).forEach(id => {
        const targetPos = tags[id];
        if (!tagMeshes[id]) {
            const geo = new THREE.SphereGeometry(0.2, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            const mesh = new THREE.Mesh(geo, mat);
            tagGroup.add(mesh);
            tagMeshes[id] = mesh;
            tagInterpolation[id] = {
                current: new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z),
                target: new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z),
            };
        }
        tagInterpolation[id].target.set(targetPos.x, targetPos.y, targetPos.z);
    });
}

function interpolateTagPositions() {
    Object.keys(tagInterpolation).forEach(id => {
        const interp = tagInterpolation[id];
        if(interp) {
            interp.current.lerp(interp.target, 0.1);
            if (tagMeshes[id]) {
                tagMeshes[id].position.copy(interp.current);
            }
        }
    });
}

// --- 2D MAP LOGIC ---
// ... (This section is omitted for brevity as it remains unchanged)

// --- UI & EVENT LISTENERS ---
function updateTable(tags) {
    const tbody = document.getElementById('tag-table-body');
    if (Object.keys(tags).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:#999;">Chờ dữ liệu...</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    Object.keys(tags).forEach(id => {
        const pos = tags[id];
        const accuracyColor = pos.accuracy < 0.5 ? '#28a745' : pos.accuracy < 1.0 ? '#ffc107' : '#dc3545';
        const row = `<tr>
            <td><b>${id}</b></td>
            <td>${pos.x.toFixed(2)}</td>
            <td>${pos.y.toFixed(2)}</td>
            <td>${pos.z.toFixed(2)}</td>
            <td style="color:${accuracyColor};font-weight:bold;">${pos.accuracy !== undefined ? '±' + pos.accuracy.toFixed(2) + 'm' : 'N/A'}</td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

// FIXED: Anchor Management UI Logic
const anchorList = document.getElementById('anchor-list');

function renderAnchorList() {
    anchorList.innerHTML = '';
    if (anchorsData.length === 0) {
        anchorList.innerHTML = '<p style="font-size:12px; color:#888; text-align:center;">Chưa có anchor nào.</p>';
    }
    anchorsData.forEach((anchor, index) => {
        const item = document.createElement('div');
        item.className = 'anchor-item';
        item.innerHTML = `
            <span class="anchor-id">A${index}</span>
            <input type="number" class="anchor-x" value="${anchor.x.toFixed(2)}" placeholder="x">
            <input type="number" class="anchor-y" value="${anchor.y.toFixed(2)}" placeholder="y">
            <input type="number" class="anchor-z" value="${anchor.z.toFixed(2)}" placeholder="z">
            <button class="btn-danger btn-remove-anchor" data-index="${index}">X</button>
        `;
        anchorList.appendChild(item);
    });
    
    document.querySelectorAll('.btn-remove-anchor').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            anchorsData.splice(index, 1);
            renderAnchorList(); // Re-render after removal
        });
    });
}

document.getElementById('btn-add-anchor').addEventListener('click', () => {
    anchorsData.push({ id: anchorsData.length, x: 0, y: 0, z: 0 });
    renderAnchorList();
});

document.getElementById('btn-save-anchors').addEventListener('click', () => {
    const newAnchors = [];
    document.querySelectorAll('#anchor-list .anchor-item').forEach((item, index) => {
        const x = parseFloat(item.querySelector('.anchor-x').value);
        const y = parseFloat(item.querySelector('.anchor-y').value);
        const z = parseFloat(item.querySelector('.anchor-z').value);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            newAnchors.push({ id: index, x, y, z });
        }
    });
    anchorsData = newAnchors;
    socket.emit('set_anchors', anchorsData);
    alert('Đã lưu lại vị trí các anchor!');
});

document.getElementById('btn-update-room').addEventListener('click', () => {
    const l = parseFloat(document.getElementById('inpL').value) || 10;
    const w = parseFloat(document.getElementById('inpW').value) || 8;
    const h = parseFloat(document.getElementById('inpH').value) || 4;
    createRoom3D(l, w, h);
    socket.emit('update_room_config', { length: l, width: w, height: h });
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
});

socket.on('anchors_updated', (data) => {
    anchorsData = data;
    updateAnchors3D(data);
    renderAnchorList(); // FIXED: Update UI on server event
});

socket.on('tags_update', (data) => {
    tagDataStore = data;
    updateTags3D(data);
    updateTable(data);
});

// --- ANIMATION LOOP & RESIZE ---
function animate() {
    requestAnimationFrame(animate);
    interpolateTagPositions();
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
