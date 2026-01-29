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

// --- DỮ LIỆU BỘ NHỚ (RAM) ---
// Anchor bây giờ có dạng: { id: 1, x: 0, y: 0, z: 2.5 }
let anchors = []; 
let tagPositions = {};
// Kích thước phòng (Mặc định)
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

client.on('message', (topic, message) => {
    try {
        const tagId = topic.split('/').pop();
        const data = JSON.parse(message.toString());
        const dists = data.distances; // { "0": 5.2, "1": 3.1, "2": 4.5, "3": 2.1 }

        // Yêu cầu tối thiểu 4 Anchor để định vị 3D chính xác
        if (anchors.length < 4) return;

        // Map dữ liệu khoảng cách vào Anchor tọa độ
        // Giả sử distance "0" ứng với anchors[0], "1" ứng với anchors[1]...
        // Cần đảm bảo anchors đã được sort đúng thứ tự ID
        
        let p1 = anchors[0], r1 = dists["0"];
        let p2 = anchors[1], r2 = dists["1"];
        let p3 = anchors[2], r3 = dists["2"];
        let p4 = anchors[3], r4 = dists["3"];

        if (r1 && r2 && r3 && r4) {
            // Tính toán 3D
            const pos = trilaterate3D(p1, p2, p3, p4, r1, r2, r3, r4);
            
            if (pos) {
                tagPositions[tagId] = pos;
                io.emit('tags_update', tagPositions);
                // console.log(`📍 ${tagId}: [${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}]`);
            }
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
function tempVec(p2, p1) { // (p2-p1) / norm
    const v = sub(p2, p1);
    return div(v, norm(v));
}

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 3D Server running on port ${PORT}`));
