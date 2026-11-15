require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const bodyParser = require('body-parser');
const layout = require('./public/layout.json');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// Cấu hình giới hạn dung lượng để nhận ảnh Base64 từ AI
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- DỮ LIỆU BỘ NHỚ (khởi tạo từ layout thật) ---
let roomConfig = { ...layout.room };
let racksData = JSON.parse(JSON.stringify(layout.racks));
const tagsData = {}; // FIX: trước đây dùng mà chưa khai báo -> ReferenceError
// Hình học nhà kho (sàn + tường). null = dùng mặc định từ layout.json ở client
let layoutGeom = null;

io.on('connection', (socket) => {
    socket.emit('room_config_update', roomConfig);
    socket.emit('racks_updated', racksData);
    if (layoutGeom) socket.emit('layout_update', { room: roomConfig, ...layoutGeom, racks: racksData });

    // Đồng bộ TOÀN BỘ layout (kích thước, sàn, tường, kệ) khi AI phân tích hoặc nạp lại layout gốc
    socket.on('set_layout', (data) => {
        const { room, floor, walls, racks } = data || {};
        if (!room || [room.length, room.width, room.height].some(v => !(v > 0 && v < 500))) return;
        const okPt = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
        if (!Array.isArray(floor) || floor.length < 3 || floor.length > 500 || !floor.every(okPt)) return;
        if (!Array.isArray(walls) || walls.length > 500 || !walls.every(w => Array.isArray(w) && w.length === 4 && w.every(Number.isFinite))) return;
        if (!Array.isArray(racks) || racks.length > 200) return;
        roomConfig = { length: room.length, width: room.width, height: room.height };
        layoutGeom = { floor, walls };
        racksData = racks;
        socket.broadcast.emit('layout_update', { room: roomConfig, floor, walls, racks });
    });

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

// --- API TÍCH HỢP GEMINI AI ---
const FT_TO_M = 0.3048;
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const clampInt = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);

const LAYOUT_PROMPT = `Bạn là hệ thống thị giác máy tính đọc bản vẽ mặt bằng kho 4-Way Shuttle.
QUY ƯỚC TỌA ĐỘ: mọi toạ độ là số từ 0.0 đến 1.0 và CHUẨN HOÁ THEO HỘP BAO NGOÀI CÙNG CỦA TƯỜNG NHÀ KHO
(KHÔNG phải theo cả bức ảnh; bỏ qua lề, logo, đường kích thước). x: 0 = mép trái, 1 = mép phải. z: 0 = mép trên, 1 = mép dưới.
Trả về:
1) length_m, width_m: kích thước tổng thể (mét) của nhà kho nếu đọc được từ các đường kích thước trên bản vẽ
   (đổi feet-inch sang mét: 1 ft = 0.3048 m). Không đọc được thì để null. length_m theo chiều ngang (x), width_m theo chiều dọc (z).
2) floor: đa giác (≥3 điểm, theo thứ tự quanh chu vi) là đường bao sàn nhà kho.
3) walls: các đoạn tường [x1,z1,x2,z2] gồm tường bao ngoài và tường ngăn phòng chính (văn phòng, WC, cầu thang). Bỏ qua cửa đi (để hở khoảng trống).
4) racks: MỖI KHỐI KỆ LIÊN TỤC là MỘT phần tử, KHÔNG tách theo từng ô pallet. Với mỗi khối cho hộp bao
   x_min, z_min, x_max, z_max của toàn bộ khối. Không nhận diện văn phòng/WC/cầu thang là kệ.
Chỉ trả về JSON.`;

app.post('/api/analyze-layout', async (req, res) => {
    try {
        const { imageBase64, realWidth, realLength, userLength, userWidth } = req.body;

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ success: false, message: "Thiếu GEMINI_API_KEY trên server." });
        }
        if (typeof imageBase64 !== 'string') {
            return res.status(400).json({ success: false, message: "Thiếu ảnh bản vẽ." });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const num = { type: "NUMBER" };
        const model = genAI.getGenerativeModel({
            model: "gemini-3.6-flash",
            systemInstruction: LAYOUT_PROMPT,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        length_m: { type: "NUMBER", nullable: true },
                        width_m: { type: "NUMBER", nullable: true },
                        floor: { type: "ARRAY", items: { type: "OBJECT", properties: { x: num, z: num }, required: ["x", "z"] } },
                        walls: { type: "ARRAY", items: { type: "OBJECT", properties: { x1: num, z1: num, x2: num, z2: num }, required: ["x1", "z1", "x2", "z2"] } },
                        racks: { type: "ARRAY", items: { type: "OBJECT", properties: { x_min: num, z_min: num, x_max: num, z_max: num }, required: ["x_min", "z_min", "x_max", "z_max"] } }
                    },
                    required: ["floor", "walls", "racks"]
                }
            }
        });

        const m = imageBase64.match(/^data:(image\/[\w.+-]+);base64,/);
        const mimeType = m ? m[1] : "image/png";
        const base64Data = imageBase64.replace(/^data:image\/[\w.+-]+;base64,/, "");

        const result = await model.generateContent([
            "Phân tích mặt bằng kho này: kích thước, đường bao sàn, tường và các khối kệ.",
            { inlineData: { data: base64Data, mimeType } }
        ]);
        const aiData = JSON.parse(result.response.text());

        // Kích thước thật: ưu tiên số người dùng nhập > số AI đọc từ bản vẽ > kích thước hiện tại
        const L = (userLength > 0 && userLength < 500) ? userLength
            : (aiData.length_m > 5 && aiData.length_m < 500) ? aiData.length_m : (realLength || 55.9);
        const W = (userWidth > 0 && userWidth < 500) ? userWidth
            : (aiData.width_m > 5 && aiData.width_m < 500) ? aiData.width_m : (realWidth || 20.4);
        const toX = (p) => r2(clamp01(p) * L);
        const toZ = (p) => r2(clamp01(p) * W);

        // Sàn: nếu AI không trả đủ đa giác thì dùng hình chữ nhật
        let floor = (aiData.floor || []).map(p => [toX(p.x), toZ(p.z)]);
        if (floor.length < 3) floor = [[0, 0], [L, 0], [L, W], [0, W]];

        // Tường: nếu AI không trả tường thì dựng tường theo cạnh của sàn
        let walls = (aiData.walls || [])
            .map(w => [toX(w.x1), toZ(w.z1), toX(w.x2), toZ(w.z2)])
            .filter(([x1, z1, x2, z2]) => Math.hypot(x2 - x1, z2 - z1) > 0.3);
        if (walls.length < 3) {
            walls = floor.map((p, i) => { const q = floor[(i + 1) % floor.length]; return [p[0], p[1], q[0], q[1]]; });
        }

        // Kệ: tính số cột/hàng từ KÍCH THƯỚC THẬT của hộp bao (không tin AI đếm)
        const CELL_X = 1.22, CELL_Z = 1.17, PITCH_Z = 1.55;
        const racks = (aiData.racks || []).map((r, i) => {
            const wReal = Math.abs(r.x_max - r.x_min) * L;
            const dReal = Math.abs(r.z_max - r.z_min) * W;
            const cols = clampInt(wReal / CELL_X, 1, 20, 2);
            const rows = clampInt(dReal / PITCH_Z, 1, 30, 4);
            const maxX = Math.max(0, L - cols * CELL_X);
            const maxZ = Math.max(0, W - rows * PITCH_Z);
            return {
                id: `rack_ai_${i + 1}`,
                cols, rows, tiers: 4, tierH: 1.5,
                cellX: CELL_X, cellZ: CELL_Z, pitchZ: PITCH_Z,
                x: r2(Math.min(maxX, Math.min(r.x_min, r.x_max) * L)),
                z: r2(Math.min(maxZ, Math.min(r.z_min, r.z_max) * W))
            };
        });

        res.json({ success: true, room: { length: r2(L), width: r2(W) }, floor, walls, racks });
    } catch (error) {
        console.error("Lỗi AI Gemini:", error);
        res.status(500).json({ success: false, message: "Lỗi phân tích bản vẽ: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
