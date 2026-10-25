require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const bodyParser = require('body-parser');
const layout = require('./public/layout.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- DỮ LIỆU BỘ NHỚ (khởi tạo từ layout thật) ---
let roomConfig = { ...layout.room };
let racksData = JSON.parse(JSON.stringify(layout.racks));
const tagsData = {}; // FIX: trước đây dùng mà chưa khai báo -> ReferenceError

io.on('connection', (socket) => {
    socket.emit('room_config_update', roomConfig);
    socket.emit('racks_updated', racksData);

    socket.on('update_room_config', (cfg) => {
        const { length, width, height } = cfg || {};
        if ([length, width, height].some(v => !(v > 0 && v < 500))) return;
        roomConfig = { length, width, height };
        io.emit('room_config_update', roomConfig);
    });

    socket.on('set_racks', (racks) => {
        if (!Array.isArray(racks) || racks.length > 200) return;
        racksData = racks;
        socket.broadcast.emit('racks_updated', racksData);
    });
});

// --- MQTT (thông tin đăng nhập lấy từ .env, không hard-code) ---
if (process.env.MQTT_HOST) {
    const client = mqtt.connect(`mqtts://${process.env.MQTT_HOST}`, {
        port: Number(process.env.MQTT_PORT) || 8883,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASS,
        protocol: 'mqtts',
        rejectUnauthorized: true
    });
    client.on('connect', () => { console.log('✅ MQTT Connected'); client.subscribe('kho_thong_minh/tags/+'); });
    client.on('error', (e) => console.error('MQTT error:', e.message));
    client.on('message', (topic, message) => {
        try {
            const tagId = topic.split('/').pop();
            tagsData[tagId] = { distances: JSON.parse(message.toString()).distances, lastUpdated: Date.now() };
        } catch (e) { console.error('MQTT Message Error:', e.message); }
    });
} else {
    console.log('ℹ️ Chưa cấu hình MQTT_HOST trong .env -> bỏ qua MQTT');
}

setInterval(() => {
    if (Object.keys(tagsData).length > 0) io.emit('tags_update', tagsData);
}, 33);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
