const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mqtt = require('mqtt');
const trilateration = require('trilateration'); // Đảm bảo dùng thư viện này

// --- 1. Khởi tạo Máy chủ Web ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// --- 2. Cấu hình ---
const PORT = 3000;
const MQTT_BROKER = 'mqtt://broker.hivemq.com';
const MQTT_TOPIC_PREFIX = 'kho_thong_minh/tags/';
const MQTT_TOPIC_WILDCARD = MQTT_TOPIC_PREFIX + '+';

// --- 3. BIẾN TOÀN CỤC ---
let anchors = []; // Mảng 12 anchor
let tagPositions = {}; // Vị trí các tag
let warehouseBays = []; // Mảng các ô kho

// --- 4. Lắng nghe Trình duyệt (Socket.io) ---
io.on('connection', (socket) => {
    console.log('Một người dùng đã kết nối qua Socket.io');

    // --- GỬI DỮ LIỆU BAN ĐẦU ---
    socket.emit('anchors_updated', anchors);
    socket.emit('tags_update', tagPositions);
    socket.emit('bays_updated', warehouseBays);

    // --- LẮNG NGHE ANCHOR ---
    socket.on('set_anchors', (anchorPositions) => {
        anchors = anchorPositions;
        console.log(`Đã cập nhật ${anchors.length} vị trí anchors.`);
        io.emit('anchors_updated', anchors);
    });
    
    // --- LẮNG NGHE Ô KHO ---
    socket.on('set_bays', (bays) => {
        warehouseBays = bays;
        console.log(`Đã cập nhật ${warehouseBays.length} ô kho.`);
        io.emit('bays_updated', warehouseBays); 
    });
});

// --- 5. Lắng nghe Tag (MQTT) ---
const client = mqtt.connect(MQTT_BROKER);
client.on('connect', () => {
    console.log('Đã kết nối tới MQTT Broker (dùng trilateration chia nhóm)');
    client.subscribe(MQTT_TOPIC_WILDCARD, (err) => {
        if (!err) {
            console.log(`Đã đăng ký nhận dữ liệu từ topic: ${MQTT_TOPIC_WILDCARD}`);
        }
    });
});

// --- 6. XỬ LÝ LOGIC "CHIA NHÓM" ---
client.on('message', (topic, message) => {
    if (topic.startsWith(MQTT_TOPIC_PREFIX)) {
        try {
            const tagId = topic.split('/')[2];
            const data = JSON.parse(message.toString());
            const distanceData = data.distances; 
            const anchorIndices = Object.keys(distanceData); 

            if (anchorIndices.length < 3) return;
            
            const i1 = anchorIndices[0];
            const i2 = anchorIndices[1];
            const i3 = anchorIndices[2];

            if (!anchors[i1] || !anchors[i2] || !anchors[i3]) return;

            trilateration.addBeacon(0, trilateration.vector(anchors[i1].x, anchors[i1].y));
            trilateration.addBeacon(1, trilateration.vector(anchors[i2].x, anchors[i2].y));
            trilateration.addBeacon(2, trilateration.vector(anchors[i3].x, anchors[i3].y));

            trilateration.setDistance(0, distanceData[i1]);
            trilateration.setDistance(1, distanceData[i2]);
            trilateration.setDistance(2, distanceData[i3]);

            const position = trilateration.calculatePosition();
            tagPositions[tagId] = position;
            io.emit('tags_update', tagPositions);

        } catch (e) {
            console.error(`Lỗi xử lý dữ liệu MQTT cho ${topic}:`, e.message);
        }
    }
});

// --- 7. Chạy Máy chủ ---
server.listen(PORT, () => {
    console.log(`Máy chủ đang chạy tại http://localhost:${PORT}`);
});