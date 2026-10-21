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

// --- KEYBOARD CONTROLS (Chỉ dành cho Camera) ---
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

// --- UI EVENT LISTENERS ---
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

// --- SOCKET LISTENERS ---
socket.on('room_config_update', (cfg) => {
    roomConfig = cfg;
    createRoom3D(cfg.length, cfg.width, cfg.height);
    document.getElementById('inpL').value = cfg.length;
    document.getElementById('inpW').value = cfg.width;
    document.getElementById('inpH').value = cfg.height;
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

// --- UI LOGIC (Bảng điều khiển & Floating Panel) ---
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
