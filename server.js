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

// --- DỮ LIỆU BỘ NHỚ ---
let roomConfig = { length: 10, width: 8, height: 4 };
let racksData = []; // Thêm dòng này để lưu dữ liệu kệ hàng

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('🔌 Client connected');
    socket.emit('room_config_update', roomConfig);
    socket.emit('racks_updated', racksData); // Gửi dữ liệu kệ khi client kết nối

    socket.on('update_room_config', (config) => {
        roomConfig = config;
        io.emit('room_config_update', roomConfig);
    });

    // Thêm block này để lắng nghe sự thay đổi kệ hàng từ client
    socket.on('set_racks', (newRacks) => {
        racksData = newRacks;
        // Broadcast cho các client khác (trừ người gửi) để đồng bộ
        socket.broadcast.emit('racks_updated', racksData); 
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

        // Bỏ thuật toán Multilateration và Kalman Filter.
        // Chỉ lưu trữ dữ liệu khoảng cách thô (raw distances) gửi qua Socket.io
        tagsData[tagId] = { distances: dists, lastUpdated: Date.now() };
        
    } catch (e) { 
        console.error('MQTT Message Error:', e); 
    }
});

// --- SERVER-SIDE UPDATE LOOP ---
const UPDATE_INTERVAL = 33; // ~30 FPS
setInterval(() => {
    if (Object.keys(tagsData).length > 0) {
        io.emit('tags_update', tagsData);
    }
}, UPDATE_INTERVAL);

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
