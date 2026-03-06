
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

const anchorGroup = new THREE.Group();
scene.add(anchorGroup);
const tagGroup = new THREE.Group();
scene.add(tagGroup);
const objectGroup = new THREE.Group();
scene.add(objectGroup);

// --- AXIS GIZMO ---
const axisContainer = document.getElementById('axis-container');
const axisScene = new THREE.Scene();
const axisCamera = new THREE.PerspectiveCamera(50, axisContainer.clientWidth / axisContainer.clientHeight, 0.1, 10);
axisCamera.position.z = 2;
const axisRenderer = new THREE.WebGLRenderer({alpha: true, antialias: true});
axisRenderer.setSize(axisContainer.clientWidth, axisContainer.clientHeight);
axisContainer.appendChild(axisRenderer.domElement);

const axisHelper = new THREE.AxesHelper(1);
axisScene.add(axisHelper);


const canvas2d = document.getElementById('main-2d-canvas');
const ctx2d = canvas2d.getContext('2d');

let roomMesh = null;
let anchorsData = [];
let objectsData = [];
let tagMeshes = {};
let tagDataStore = {};
let tagInterpolation = {};
let roomConfig = { length: 10, width: 8, height: 4 };

// --- 3D LOGIC ---
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

function updateAnchors3D(anchors) {
    while(anchorGroup.children.length > 0) anchorGroup.remove(anchorGroup.children[0]);
    anchors.forEach(anc => {
        const geo = new THREE.SphereGeometry(0.15, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x00aaff }); 
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(anc.x, anc.z, anc.y); 
        anchorGroup.add(mesh);
    });
}

function updateObjects3D() {
    while(objectGroup.children.length > 0) objectGroup.remove(objectGroup.children[0]);
    objectsData.forEach(obj => {
        const geometry = new THREE.BoxGeometry(obj.l, obj.h, obj.w);
        const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(obj.x, obj.z, obj.y);
        objectGroup.add(mesh);
    });
}

function updateTags3D(tags) {
    Object.keys(tags).forEach(id => {
        const targetPos = tags[id];
        if (!tagMeshes[id]) {
            const geo = new THREE.SphereGeometry(0.2, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: 0xff4444 }); 
            const mesh = new THREE.Mesh(geo, mat);
            tagGroup.add(mesh);
            tagMeshes[id] = mesh;
            tagInterpolation[id] = {
                current: new THREE.Vector3(targetPos.x, targetPos.z, targetPos.y),
                target: new THREE.Vector3(targetPos.x, targetPos.z, targetPos.y),
            };
        }
        tagInterpolation[id].target.set(targetPos.x, targetPos.z, targetPos.y);
    });
}

function interpolateTagPositions() {
    Object.keys(tagInterpolation).forEach(id => {
        const interp = tagInterpolation[id];
        if(interp) {
            interp.current.lerp(interp.target, 0.2);
            if (tagMeshes[id]) {
                tagMeshes[id].position.copy(interp.current);
            }
        }
    });
}

// --- KEYBOARD CONTROLS ---
const keyStates = {};
window.addEventListener('keydown', (event) => {
    keyStates[event.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (event) => {
    keyStates[event.key.toLowerCase()] = false;
});

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

// --- UI & EVENT LISTENERS ---
function updateCollapsibleHeight(content) {
    if (content && content.style.maxHeight && content.style.maxHeight !== '0px' && content.style.maxHeight !== 'fit-content') {
        content.style.maxHeight = content.scrollHeight + "px";
    }
}

function updateTable(tags) {
    const tbody = document.getElementById('tag-table-body');
    if (Object.keys(tags).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:#999;">Waiting for data...</td></tr>';
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
            <td style="color:${accuracyColor};font-weight:bold;">${pos.accuracy !== undefined ? '±' + pos.accuracy.toFixed(2) : 'N/A'}</td>
        </tr>`;
        tbody.innerHTML += row;
    });
}

const anchorList = document.getElementById('anchor-list');
const objectList = document.getElementById('object-list');

function renderAnchorList() {
    anchorList.innerHTML = '';
    anchorsData.forEach((anchor, index) => {
        const item = document.createElement('div');
        item.className = 'anchor-item';
        item.innerHTML = `
            <span class="anchor-id">A${index}</span>
            <input type="number" class="anchor-x" value="${anchor.x.toFixed(2)}" placeholder="x" data-index="${index}">
            <input type="number" class="anchor-y" value="${anchor.y.toFixed(2)}" placeholder="y" data-index="${index}">
            <input type="number" class="anchor-z" value="${anchor.z.toFixed(2)}" placeholder="z" data-index="${index}">
            <button class="btn-remove-anchor" data-index="${index}">X</button>
        `;
        anchorList.appendChild(item);
    });
    
    document.querySelectorAll('.btn-remove-anchor').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            anchorsData.splice(index, 1);
            saveAnchors();
            renderAnchorList();
        });
    });

    document.querySelectorAll('#anchor-list input').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            const axis = e.target.classList.contains('anchor-x') ? 'x' : e.target.classList.contains('anchor-y') ? 'y' : 'z';
            anchorsData[index][axis] = parseFloat(e.target.value);
            saveAnchors();
        });
    });
}

function saveAnchors() {
    socket.emit('set_anchors', anchorsData);
    updateAnchors3D(anchorsData);
}

function renderObjectList() {
    objectList.innerHTML = '';
    objectsData.forEach((obj, index) => {
        const item = document.createElement('div');
        item.className = 'object-item';
        item.innerHTML = `
            <div class="object-header">
                <span class="object-id">OBJ ${index + 1}</span>
                <button class="btn-remove-object" data-index="${index}">X</button>
            </div>
            <div class="object-props">
                <div class="prop-group">
                    <label>Kích thước:</label>
                    <input type="number" class="obj-l" value="${obj.l}" data-index="${index}" placeholder="D">
                    <input type="number" class="obj-w" value="${obj.w}" data-index="${index}" placeholder="R">
                    <input type="number" class="obj-h" value="${obj.h}" data-index="${index}" placeholder="C">
                </div>
                <div class="prop-group">
                    <label>Vị trí:</label>
                    <input type="number" class="obj-x" value="${obj.x}" data-index="${index}" placeholder="X">
                    <input type="number" class="obj-y" value="${obj.y}" data-index="${index}" placeholder="Y">
                    <input type="number" class="obj-z" value="${obj.z}" data-index="${index}" placeholder="Z">
                </div>
            </div>
        `;
        objectList.appendChild(item);
    });

    document.querySelectorAll('.btn-remove-object').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            objectsData.splice(index, 1);
            renderObjectList();
            updateObjects3D();
        });
    });

    document.querySelectorAll('#object-list input').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            const prop = e.target.classList[0].split('-')[1];
            objectsData[index][prop] = parseFloat(e.target.value);
            updateObjects3D();
        });
    });
}

document.getElementById('btn-add-anchor').addEventListener('click', () => {
    anchorsData.push({ id: anchorsData.length, x: 0, y: 0, z: 0 });
    renderAnchorList();
    saveAnchors();
    updateCollapsibleHeight(document.querySelector('#anchors-section .collapsible-content'));

});

document.getElementById('btn-add-object').addEventListener('click', () => {
    objectsData.push({l: 1, w: 1, h: 1, x: 0, y: 0, z: 0});
    renderObjectList();
    updateObjects3D();
    updateCollapsibleHeight(document.querySelector('#objects-section .collapsible-content'));
});

document.getElementById('inpL').addEventListener('change', updateRoom);
document.getElementById('inpW').addEventListener('change', updateRoom);
document.getElementById('inpH').addEventListener('change', updateRoom);

function updateRoom(){
    const l = parseFloat(document.getElementById('inpL').value) || 10;
    const w = parseFloat(document.getElementById('inpW').value) || 8;
    const h = parseFloat(document.getElementById('inpH').value) || 4;
    createRoom3D(l, w, h);
    socket.emit('update_room_config', { length: l, width: w, height: h });
}

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
    renderAnchorList(); 
});

socket.on('tags_update', (data) => {
    tagDataStore = data;
    updateTags3D(data);
    updateTable(data);
});

// --- ANIMATION LOOP & RESIZE ---
function animate() {
    requestAnimationFrame(animate);
    updateCameraMovement();
    interpolateTagPositions();
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
renderAnchorList();
renderObjectList();
window.dispatchEvent(new Event('resize'));

// --- UI LOGIC (MOVED FROM INDEX.HTML) ---

// Switch between 3D and 2D modes
const btn3d = document.getElementById('btn-mode-3d');
const btn2d = document.getElementById('btn-mode-2d');
const sceneContainer = document.getElementById('scene-container');
const mapContainer = document.getElementById('map-2d-container');

btn3d.addEventListener('click', () => {
    sceneContainer.style.display = 'block';
    mapContainer.style.display = 'none';
    axisContainer.style.display = 'block';
    btn3d.classList.add('active');
    btn2d.classList.remove('active');
});

btn2d.addEventListener('click', () => {
    sceneContainer.style.display = 'none';
    mapContainer.style.display = 'flex';
    axisContainer.style.display = 'none';
    btn2d.classList.add('active');
    btn3d.classList.remove('active');
    window.dispatchEvent(new Event('resize')); 
});

// Collapsible sections
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

// Floating Panel Logic
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
