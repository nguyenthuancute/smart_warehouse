
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
        this.Q = Q;
        this.R = R;
        this.P = { x: 1, y: 1, z: 1 };
        this.X = { x: 0, y: 0, z: 0 };
        this.initialized = false;
    }

    filter(measurement) {
        if (!this.initialized) {
            this.X = { ...measurement };
            this.initialized = true;
            return this.X;
        }

        ['x', 'y', 'z'].forEach(axis => {
            if (measurement[axis] === undefined || isNaN(measurement[axis])) return;
            const P_pred = this.P[axis] + this.Q[axis];
            const K = P_pred / (P_pred + this.R[axis]);
            this.X[axis] = this.X[axis] + K * (measurement[axis] - this.X[axis]);
            this.P[axis] = (1 - K) * P_pred;
        });

        return { ...this.X };
    }
}

// --- DỮ LIỆU BỘ NHỚ ---
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

// --- MQTT ---
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

        if (anchors.length < 4) return; // Multilateration requires at least 4 anchors

        const distArray = Object.keys(dists).map(idx => ({
            anchor: anchors[parseInt(idx)],
            distance: dists[idx]
        })).filter(d => d.anchor && typeof d.distance === 'number' && d.distance > 0);

        if (distArray.length < 4) return;

        const rawPos = multilateration(distArray);

        if (rawPos && isValidPosition(rawPos)) {
            if (!kalmanFilters[tagId]) {
                kalmanFilters[tagId] = new KalmanFilter({
                    Q: { x: 0.005, y: 0.005, z: 0.002 },
                    R: { x: 0.8, y: 0.8, z: 1.0 }
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

// --- MATRIX HELPER FUNCTIONS ---
function mat_transpose(matrix) {
    if (!matrix || matrix.length === 0) return [];
    return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
}

function mat_multiply(A, B) {
    // Handle matrix-vector multiplication
    if (B.every(el => typeof el === 'number')) {
        if (A[0].length !== B.length) throw new Error("Matrix dimensions are not compatible for multiplication.");
        let result = new Array(A.length).fill(0);
        for (let i = 0; i < A.length; i++) {
            for (let j = 0; j < B.length; j++) {
                result[i] += A[i][j] * B[j];
            }
        }
        return result;
    }
    // Handle matrix-matrix multiplication
    if (A[0].length !== B.length) throw new Error("Matrix dimensions are not compatible for multiplication.");
    let result = new Array(A.length).fill(0).map(() => new Array(B[0].length).fill(0));
    for (let i = 0; i < A.length; i++) {
        for (let j = 0; j < B[0].length; j++) {
            for (let k = 0; k < A[0].length; k++) {
                result[i][j] += A[i][k] * B[k][j];
            }
        }
    }
    return result;
}

function mat_invert_3x3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (det === 0) return null; // Not invertible
    const invDet = 1.0 / det;
    const result = [
        [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
        [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
        [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet]
    ];
    return result;
}

// --- THUẬT TOÁN ĐỊNH VỊ (MULTILATERATION) ---
// This new implementation uses gradient descent to refine the position estimate,
// which generally improves accuracy, especially with more anchors.
function multilateration(distArray, { iterations = 20, learningRate = 0.01 } = {}) {
    // Get an initial estimate using the linear method
    const initialGuess = multilateration_linear(distArray);
    if (!initialGuess) {
        return null;
    }

    let currentPosition = { ...initialGuess };

    // Iteratively refine the position using Gradient Descent
    for (let iter = 0; iter < iterations; iter++) {
        let gradient = { x: 0, y: 0, z: 0 };

        // Calculate the gradient of the objective function (sum of squared errors)
        for (const item of distArray) {
            const { anchor, distance } = item;
            const calculatedDist = Math.sqrt(
                (currentPosition.x - anchor.x) ** 2 +
                (currentPosition.y - anchor.y) ** 2 +
                (currentPosition.z - anchor.z) ** 2
            );

            if (calculatedDist < 1e-6) continue; // Avoid division by zero

            // Derivative of squared error: 2 * (calculatedDist - distance) * (derivative of calculatedDist)
            // Derivative of calculatedDist wrt x is (currentPosition.x - anchor.x) / calculatedDist
            const commonFactor = 2 * (1 - distance / calculatedDist);
            gradient.x += commonFactor * (currentPosition.x - anchor.x);
            gradient.y += commonFactor * (currentPosition.y - anchor.y);
            gradient.z += commonFactor * (currentPosition.z - anchor.z);
        }

        // Update the position by moving against the gradient
        currentPosition.x -= learningRate * gradient.x;
        currentPosition.y -= learningRate * gradient.y;
        currentPosition.z -= learningRate * gradient.z;
    }

    return currentPosition;
}

// Solves the linearized system of equations to get a good initial guess.
function multilateration_linear(distArray) {
    if (distArray.length < 4) {
        return null;
    }

    const refAnchor = distArray[distArray.length - 1].anchor;
    const refDist = distArray[distArray.length - 1].distance;
    const refAnchorSq = refAnchor.x ** 2 + refAnchor.y ** 2 + refAnchor.z ** 2;

    const A = [];
    const b = [];

    for (let i = 0; i < distArray.length - 1; i++) {
        const anchor = distArray[i].anchor;
        const dist = distArray[i].distance;

        A.push([
            2 * (refAnchor.x - anchor.x),
            2 * (refAnchor.y - anchor.y),
            2 * (refAnchor.z - anchor.z)
        ]);
        
        const anchorSq = anchor.x ** 2 + anchor.y ** 2 + anchor.z ** 2;
        b.push(
            dist ** 2 - refDist ** 2 - anchorSq + refAnchorSq
        );
    }

    try {
        const A_T = mat_transpose(A);
        const A_T_A = mat_multiply(A_T, A);
        const A_T_A_inv = mat_invert_3x3(A_T_A);

        if (!A_T_A_inv) {
             console.error("Matrix A^T*A is not invertible. Check anchor geometry.");
             return null;
        }

        const A_T_b = mat_multiply(A_T, b);
        const pos = mat_multiply(A_T_A_inv, A_T_b);
        
        return { x: pos[0], y: pos[1], z: pos[2] };

    } catch (e) {
        console.error("Error during linear multilateration calculation:", e);
        return null;
    }
}


function isValidPosition(pos) {
    if (!pos || isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) return false;
    const buffer = 5; // Increase buffer to be more tolerant
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
