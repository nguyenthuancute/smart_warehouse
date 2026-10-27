require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const bodyParser = require('body-parser');
const layout = require('./public/layout.json');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
app.post('/api/analyze-layout', async (req, res) => {
    try {
        const { imageBase64, realWidth, realLength } = req.body;

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ success: false, message: "Thiếu GEMINI_API_KEY trên server." });
        }

        // Cấu hình Model với Structured Output để ép khuôn JSON an toàn
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            systemInstruction: "Bạn là hệ thống thị giác máy tính cho mặt bằng kho 4-Way Shuttle. Hãy nhận diện các cụm kệ, xác định tâm theo tỷ lệ phần trăm (0.0 đến 1.0) tính từ góc trên-trái của bức ảnh, và đếm số cột/hàng. Chỉ trả về JSON.",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        racks: {
                            type: "ARRAY",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    x_percent: { type: "NUMBER" },
                                    z_percent: { type: "NUMBER" },
                                    cols: { type: "INTEGER" },
                                    rows: { type: "INTEGER" }
                                },
                                required: ["x_percent", "z_percent", "cols", "rows"]
                            }
                        }
                    },
                    required: ["racks"]
                }
            }
        });

        // Tách bỏ header của chuỗi Base64
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

        const result = await model.generateContent([
            "Phân tích ảnh mặt bằng kho này và trích xuất thông số các cụm kệ hàng.",
            {
                inlineData: { data: base64Data, mimeType: "image/png" }
            }
        ]);

        const aiData = JSON.parse(result.response.text());

        // Chuyển đổi tỷ lệ phần trăm thành tọa độ gốc hệ Three.js (0,0 ở giữa mặt phẳng sàn)
        const finalRacks = aiData.racks.map((rack, index) => ({
            id: `rack_ai_${index + 1}`,
            cols: rack.cols,
            rows: rack.rows,
            levels: 4, 
            levelHeight: 1.5,
            x: (rack.x_percent * realWidth) - (realWidth / 2),
            z: (rack.z_percent * realLength) - (realLength / 2)
        }));

        res.json({ success: true, racks: finalRacks });
    } catch (error) {
        console.error("Lỗi AI Gemini:", error);
        res.status(500).json({ success: false, message: "Lỗi phân tích bản vẽ: " + error.message });
    }
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
