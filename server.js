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
    constructor() {
        this.Q = 0.005;
        this.R = 0.8;
        this.P = { x: 1, y: 1, z: 1 };
        this.X = { x: 0, y: 0, z: 0 };
        this.K = { x: 0, y: 0, z: 0 };
        this.initialized = false;
    }

    filter(measurement) {
        if (!this.initialized) {
            this.X = { ...measurement };
            this.initialized = true;
            return this.X;
        }

        ['x', 'y', 'z'].forEach(axis => {
            const P_pred = this.P[axis] + this.Q;
            this.K[axis] = P_pred / (P_pred + this.R);
            this.X[axis] = this.X[axis] + this.K[axis] * (measurement[axis] - this.X[axis]);
            this.P[axis] = (1 - this.K[axis]) * P_pred;
        });

        return { ...this.X };
    }
}

// --- DỮ LIỆU BỘ NHỚ (RAM) ---
let anchors = [];
let tagPositions = {};
let kalmanFilters = {};
let tagHistory = {};
let roomConfig = { width: 10, length: 20, height: 4 };

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('🔌 Client connected');

    // Gửi cấu hình hiện tại cho user mới
    socket.emit('room_config_update', roomConfig);
    socket.emit('anchors_updated', anchors);

    // 1. Nhận cấu hình kích thước phòng
    socket.on('update_room_config', (config) => {
        roomConfig = config; // { width, length, height, originCorner }
        io.emit('room_config_update', roomConfig);
    });

    // 2. Nhận danh sách Anchor từ Admin (x, y, z)
    socket.on('set_anchors', (newAnchors) => {
        anchors = newAnchors;
        console.log("📡 Updated Anchors:", anchors);
        io.emit('anchors_updated', anchors);
    });
});

// --- MQTT (NHẬN KHOẢNG CÁCH) ---
const MQTT_HOST = 'ac283ced08d54c199286b8bdb567f195.s1.eu.hivemq.cloud'; // Điền lại host của bạn
const MQTT_PORT = 8883;
const MQTT_USER = 'smart_warehouse'; // Điền user của bạn
const MQTT_PASS = 'Thuan@06032006'; // Điền pass của bạn

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

        if (anchors.length < 4) return;

        const distArray = Object.keys(dists).map(idx => ({
            anchor: anchors[parseInt(idx)],
            distance: dists[idx]
        })).filter(d => d.anchor);

        if (distArray.length < 4) return;

        const rawPos = trilaterateMultiPoint(distArray);

        if (rawPos && isValidPosition(rawPos)) {
            if (!kalmanFilters[tagId]) {
                kalmanFilters[tagId] = new KalmanFilter();
            }

            const smoothedPos = kalmanFilters[tagId].filter(rawPos);

            if (!tagHistory[tagId]) {
                tagHistory[tagId] = [];
            }
            tagHistory[tagId].push({ ...smoothedPos, timestamp: Date.now() });
            if (tagHistory[tagId].length > 10) {
                tagHistory[tagId].shift();
            }

            const accuracy = calculateAccuracy(distArray, smoothedPos);
            tagPositions[tagId] = { ...smoothedPos, accuracy };

            io.emit('tags_update', tagPositions);
        }
    } catch (e) { console.error(e); }
});

// --- THUẬT TOÁN ĐỊNH VỊ 3D (4 HÌNH CẦU) ---
function trilaterate3D(p1, p2, p3, p4, r1, r2, r3, r4) {
    try {
        // Đây là bài toán giải hệ phương trình cầu.
        // Để đơn giản và nhanh trong Node.js, ta dùng thuật toán hình học:
        // Bước 1: Tìm giao điểm của 3 mặt cầu đầu tiên (thường ra 2 điểm).
        // Bước 2: Dùng mặt cầu thứ 4 để chọn điểm đúng nhất.

        // Chuyển đổi công thức đại số tuyến tính (Linear Algebra)
        // Cách giải đơn giản nhất cho 3D Trilateration:
        // x^2 + y^2 + z^2 = r^2
        // Ta dùng thư viện hoặc công thức trực tiếp. Ở đây tôi viết hàm custom đơn giản hóa:
        
        // Để code gọn, ta giả định p1 là gốc tạm thời (0,0,0) để tính, sau đó cộng lại.
        // Tuy nhiên, để chính xác nhất mà không cần thư viện nặng, ta dùng xấp xỉ trọng số (Weighted Centroid)
        // hoặc giải thuật toán Intersection of 3 Spheres.
        
        // Dưới đây là cài đặt giải thuật toán gốc (Exact Solution):
        // 1. Giải hệ phương trình 3 cầu p1, p2, p3
        const ex = tempVec(p2, p1); // vector đơn vị p1->p2
        const i = dot(ex, sub(p3, p1));
        const ey = sub(sub(p3, p1), mul(ex, i));
        const eyNorm = norm(ey);
        // if (eyNorm == 0) return null; // p1, p2, p3 thẳng hàng -> Lỗi
        const ey_unit = div(ey, eyNorm);
        const ez = cross(ex, ey_unit);
        
        const d = norm(sub(p2, p1));
        const j = dot(ey_unit, sub(p3, p1));
        
        const x = (r1*r1 - r2*r2 + d*d) / (2*d);
        const y = ((r1*r1 - r3*r3 + i*i + j*j) / (2*j)) - ((i/j)*x);
        
        // z = +/- căn bậc 2
        const zSq = r1*r1 - x*x - y*y;
        if (zSq < 0) return null; // Không cắt nhau
        const z = Math.sqrt(zSq);

        // Ta có 2 kết quả: Res1 (z dương) và Res2 (z âm)
        // Tọa độ cục bộ
        const res1 = add(p1, add(mul(ex, x), add(mul(ey_unit, y), mul(ez, z))));
        const res2 = add(p1, add(mul(ex, x), add(mul(ey_unit, y), mul(ez, -z))));

        // 2. Dùng Anchor thứ 4 (p4, r4) để kiểm tra xem Res1 hay Res2 đúng
        const dist1 = Math.abs(norm(sub(res1, p4)) - r4);
        const dist2 = Math.abs(norm(sub(res2, p4)) - r4);

        return dist1 < dist2 ? res1 : res2;

    } catch (e) { return null; }
}

// Các hàm vector phụ trợ cho thuật toán trên
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function mul(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function div(a, s) { return { x: a.x / s, y: a.y / s, z: a.z / s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function norm(a) { return Math.sqrt(dot(a, a)); }
function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}
function tempVec(p2, p1) {
    const v = sub(p2, p1);
    return div(v, norm(v));
}

function trilaterateMultiPoint(distArray) {
    if (distArray.length < 4) return null;

    distArray.sort((a, b) => a.distance - b.distance);

    const p1 = distArray[0].anchor, r1 = distArray[0].distance;
    const p2 = distArray[1].anchor, r2 = distArray[1].distance;
    const p3 = distArray[2].anchor, r3 = distArray[2].distance;
    const p4 = distArray[3].anchor, r4 = distArray[3].distance;

    const pos = trilaterate3D(p1, p2, p3, p4, r1, r2, r3, r4);

    if (pos && distArray.length > 4) {
        let totalWeight = 0;
        let weightedPos = { x: 0, y: 0, z: 0 };

        distArray.slice(0, 6).forEach(({ anchor, distance }) => {
            const weight = 1 / (distance + 0.1);
            weightedPos.x += anchor.x * weight;
            weightedPos.y += anchor.y * weight;
            weightedPos.z += anchor.z * weight;
            totalWeight += weight;
        });

        if (totalWeight > 0) {
            weightedPos.x /= totalWeight;
            weightedPos.y /= totalWeight;
            weightedPos.z /= totalWeight;

            return {
                x: pos.x * 0.7 + weightedPos.x * 0.3,
                y: pos.y * 0.7 + weightedPos.y * 0.3,
                z: pos.z * 0.7 + weightedPos.z * 0.3
            };
        }
    }

    return pos;
}

function isValidPosition(pos) {
    if (!pos || isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) return false;
    if (pos.x < -1 || pos.x > roomConfig.length + 1) return false;
    if (pos.y < -1 || pos.y > roomConfig.width + 1) return false;
    if (pos.z < 0 || pos.z > roomConfig.height + 2) return false;
    return true;
}

function calculateAccuracy(distArray, pos) {
    let totalError = 0;
    distArray.forEach(({ anchor, distance }) => {
        const calculatedDist = norm(sub(pos, anchor));
        totalError += Math.abs(calculatedDist - distance);
    });
    return totalError / distArray.length;
}

const PORT = 3000;
server.listen(PORT, () => console.log(`3D Server running on port ${PORT}`));