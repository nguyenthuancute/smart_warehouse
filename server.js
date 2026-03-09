
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mqtt = require('mqtt');
const bodyParser = require('body-parser');

// --- CẤU HÌNH ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- KALMAN FILTER CLASS ---
class KalmanFilter {
    constructor({ Q = {x: 0.005, y: 0.005, z: 0.005}, R = {x: 0.8, y: 0.8, z: 0.8} } = {}) {
        this.Q = Q; // Process noise covariance
        this.R = R;   // Measurement noise covariance
        this.P = { x: 1, y: 1, z: 1 }; // Estimation error covariance
        this.X = { x: 0, y: 0, z: 0 }; // State
        this.initialized = false;
    }

    filter(measurement) {
        if (!this.initialized) {
            this.X = { ...measurement };
            this.initialized = true;
            return this.X;
        }

        ['x', 'y', 'z'].forEach(axis => {
            if (measurement[axis] === undefined) return;
            const P_pred = this.P[axis] + this.Q[axis];
            const K = P_pred / (P_pred + this.R[axis]);
            this.X[axis] = this.X[axis] + K * (measurement[axis] - this.X[axis]);
            this.P[axis] = (1 - K) * P_pred;
        });

        return { ...this.X };
    }
}


// --- DỮ LIỆU BỘ NHỚ (RAM) ---
let anchors = [];
let tagPositions = {};
let kalmanFilters = {};
let roomConfig = { length: 10, width: 8, height: 4 };

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('🔌 Client connected');

    socket.emit('room_config_update', roomConfig);
    socket.emit('anchors_updated', anchors);

    socket.on('update_room_config', (config) => {
        roomConfig = config;
        io.emit('room_config_update', roomConfig);
    });

    socket.on('set_anchors', (newAnchors) => {
        anchors = newAnchors;
        console.log("📡 Updated Anchors:", anchors);
        io.emit('anchors_updated', anchors);
    });
});

// --- MQTT (NHẬN KHOẢNG CÁCH) ---
const MQTT_HOST = 'ac283ced08d54c199286b8bdb567f195.s1.eu.hivemq.cloud';
const MQTT_PORT = 8883;
const MQTT_USER = 'smart_warehouse';
const MQTT_PASS = 'Thuan@06032006';

const client = mqtt.connect(`mqtts://${MQTT_HOST}`, {
    port: MQTT_PORT,
    username: MQTT_USER,
    password: MQTT_PASS,
    protocol: 'mqtts',
    rejectUnauthorized: true
});

client.on('connect', () => {
    console.log('✅ MQTT Connected');
    client.subscribe('kho_thong_minh/tags/+');
});

client.on('message', async (topic, message) => {
    try {
        const tagId = topic.split('/').pop();
        const data = JSON.parse(message.toString());
        const dists = data.distances;

        if (anchors.length < 3) return;

        const distArray = Object.keys(dists).map(idx => ({
            anchor: anchors[parseInt(idx)],
            distance: dists[idx]
        })).filter(d => d.anchor && typeof d.distance === 'number' && d.distance > 0);

        if (distArray.length < 3) return;

        const rawPos = calculateTagPosition(distArray, roomConfig);

        if (rawPos && isValidPosition(rawPos)) {
            if (!kalmanFilters[tagId]) {
                 kalmanFilters[tagId] = new KalmanFilter({
                    Q: { x: 0.005, y: 0.005, z: 0.001 }, 
                    R: { x: 0.8, y: 0.8, z: 1.2 }       
                });
            }

            const smoothedPos = kalmanFilters[tagId].filter(rawPos);
            const accuracy = calculateAccuracy(distArray, smoothedPos);
            
            tagPositions[tagId] = { ...smoothedPos, accuracy };
        }
    } catch (e) { console.error('MQTT Message Error:', e); }
});

// --- SERVER-SIDE UPDATE LOOP ---
const UPDATE_INTERVAL = 33; // ~30 FPS
setInterval(() => {
    if (Object.keys(tagPositions).length > 0) {
        io.emit('tags_update', tagPositions);
    }
}, UPDATE_INTERVAL);


// --- THUẬT TOÁN ĐỊNH VỊ ---
function calculateTagPosition(distArray, roomConfig) {
    // --- Step 1: Calculate 2D position (X, Y) using weighted centroid ---
    let totalWeightXY = 0;
    let weightedPosX = 0;
    let weightedPosY = 0;

    distArray.forEach(({ anchor, distance }) => {
        const weight = 1.0 / (distance + 0.001);
        weightedPosX += anchor.x * weight;
        weightedPosY += anchor.y * weight;
        totalWeightXY += weight;
    });

    if (totalWeightXY === 0) return null;

    const posX = weightedPosX / totalWeightXY;
    const posY = weightedPosY / totalWeightXY;

    // --- Step 2: Calculate Z for each anchor and get a weighted average ---
    let zEstimations = [];
    distArray.forEach(({ anchor, distance }) => {
        const horizontalDistSq = Math.pow(posX - anchor.x, 2) + Math.pow(posY - anchor.y, 2);
        const distSq = Math.pow(distance, 2);

        if (distSq > horizontalDistSq) {
            const zDiff = Math.sqrt(distSq - horizontalDistSq);
            const z1 = anchor.z - zDiff; // Solution assuming tag is below anchor
            const z2 = anchor.z + zDiff; // Solution assuming tag is above anchor

            // Heuristic: Choose the Z value that is within the room's height boundaries.
            // This is crucial if anchors are placed at various heights.
            const z1_in_bounds = z1 >= 0 && z1 <= roomConfig.height;
            const z2_in_bounds = z2 >= 0 && z2 <= roomConfig.height;

            let estimatedZ = z1; // Default to the 'below' solution
            if (z1_in_bounds && !z2_in_bounds) {
                estimatedZ = z1;
            } else if (!z1_in_bounds && z2_in_bounds) {
                estimatedZ = z2;
            }

            // Weight for Z is higher for anchors more directly above/below the tag
            const weightZ = 1.0 / (Math.sqrt(horizontalDistSq) + 0.01);
            zEstimations.push({ z: estimatedZ, weight: weightZ });
        }
    });

    if (zEstimations.length === 0) return null; // Cannot determine Z

    // --- Step 3: Weighted average of Z estimations ---
    let totalWeightZ = 0;
    let weightedPosZ = 0;
    zEstimations.forEach(({ z, weight }) => {
        weightedPosZ += z * weight;
        totalWeightZ += weight;
    });

    const posZ = weightedPosZ / totalWeightZ;

    return { x: posX, y: posY, z: posZ };
}

function isValidPosition(pos) {
    if (!pos || isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) return false;
    const buffer = 2; 
    if (pos.x < -buffer || pos.x > roomConfig.length + buffer) return false;
    if (pos.y < -buffer || pos.y > roomConfig.width + buffer) return false; 
    if (pos.z < -buffer || pos.z > roomConfig.height + buffer) return false;
    return true;
}

function calculateAccuracy(distArray, pos) {
    if (!pos) return 99;
    let totalError = 0;
    distArray.forEach(({ anchor, distance }) => {
        const calculatedDist = Math.sqrt(
            Math.pow(pos.x - anchor.x, 2) +
            Math.pow(pos.y - anchor.y, 2) +
            Math.pow(pos.z - anchor.z, 2)
        );
        totalError += Math.abs(calculatedDist - distance);
    });
    return totalError / distArray.length;
}

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 3D Server running on http://localhost:${PORT}`));
