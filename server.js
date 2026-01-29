require('dotenv').config(); 
const MongoStore = require('connect-mongo');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mqtt = require('mqtt');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose'); 

// --- BIẾN TOÀN CỤC ---
let anchors = []; 
let tagPositions = {};
// Mặc định: Anchor cao 2.5m, Tag cao 1.0m
let heightConfig = { anchorHeight: 2.5, tagHeight: 1.0 };

// [MỚI] Biến lưu kích thước kho thực tế (Mét) - Mặc định 10x20m
let mapDimensions = { width: 10.0, length: 20.0 }; 
// Server quy định ảnh bản đồ chuẩn luôn được xử lý ở mốc 800px chiều rộng
const SERVER_MAP_PIXEL_WIDTH = 800; 

// --- 1. KẾT NỐI MONGODB ---
const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) {
    console.error("LỖI: Chưa cấu hình MONGO_URI trong file .env!");
} else {
    mongoose.connect(mongoURI)
        .then(() => console.log('✅ Đã kết nối thành công tới MongoDB Atlas'))
        .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));
}

// --- 2. ĐỊNH NGHĨA SCHEMA ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'employee' }
});
const User = mongoose.model('User', UserSchema);

const ConfigSchema = new mongoose.Schema({
    type: { type: String, unique: true }, 
    data: Array
});
const Config = mongoose.model('Config', ConfigSchema);

const BaySchema = new mongoose.Schema({
    id: Number, x: Number, y: Number, tiers: Array
});
const Bay = mongoose.model('Bay', BaySchema);


// --- 3. KHỞI TẠO APP ---
const app = express();
const server = http.createServer(app);

// Cấu hình Session
const sessionMiddleware = session({
    secret: 'secret-key-kho-thong-minh',
    resave: false,
    saveUninitialized: false,
    store: mongoURI ? MongoStore.create({
        mongoUrl: mongoURI,
        ttl: 24 * 60 * 60, 
        touchAfter: 24 * 3600, 
        autoRemove: 'native'
    }) : null, 
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.json()); 

// --- 4. HÀM TẢI DỮ LIỆU TỪ DB ---
async function loadDataFromDB() {
    if (!mongoURI) return;
    try {
        // Tải Anchors
        const anchorConfig = await Config.findOne({ type: 'anchors' });
        if (anchorConfig) anchors = anchorConfig.data;

        // Tải Cấu hình Độ cao
        const hConfig = await Config.findOne({ type: 'height_settings' });
        if (hConfig && hConfig.data && hConfig.data.length > 0) {
            heightConfig = hConfig.data[0]; 
        }

        // [MỚI] Tải Kích thước Map
        const mapDimConfig = await Config.findOne({ type: 'map_dimensions' });
        if (mapDimConfig && mapDimConfig.data && mapDimConfig.data.length > 0) {
            mapDimensions = mapDimConfig.data[0];
        }
        
        console.log(`📡 Dữ liệu: Map ${mapDimensions.width}x${mapDimensions.length}m | Height: A=${heightConfig.anchorHeight}m T=${heightConfig.tagHeight}m`);
    } catch (e) { console.error("Lỗi tải dữ liệu:", e); }
}
loadDataFromDB(); // Gọi hàm khi khởi động

// --- 5. ROUTE AUTHENTICATION ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;
    try {
        if (mongoURI) {
            const existingUser = await User.findOne({ username });
            if (existingUser) return res.send('Tên tồn tại. <a href="/register">Thử lại</a>');
            const newUser = new User({ username, password, role });
            await newUser.save();
        }
        res.redirect('/login');
    } catch (e) { res.status(500).send("Lỗi: " + e.message); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        let user = null;
        if (mongoURI) {
            user = await User.findOne({ username, password });
        } else {
            if (username === 'admin' && password === 'admin') user = { username: 'admin', role: 'admin' };
        }

        if (user) {
            req.session.user = { username: user.username, role: user.role };
            req.session.save();
            res.redirect('/');
        } else {
            res.send('Sai thông tin. <a href="/login">Thử lại</a>');
        }
    } catch (e) { res.status(500).send("Lỗi server"); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

function checkAuth(req, res, next) {
    if (req.session.user) next();
    else res.redirect('/login');
}

app.get('/', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/me', checkAuth, (req, res) => res.json(req.session.user));


// --- 6. SOCKET.IO ---
const io = new Server(server);
io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));

io.on('connection', async (socket) => {
    console.log('🔌 Client Web đã kết nối');
    const session = socket.request.session;
    if (!session.user) { /* socket.disconnect(); return; */ } 
    const userRole = session.user ? session.user.role : 'admin';

    // Gửi các cấu hình hiện tại cho Client mới vào
    socket.emit('height_config_update', heightConfig);
    socket.emit('map_dimensions_update', mapDimensions); // [MỚI]
    socket.emit('anchors_updated', anchors);
    socket.emit('tags_update', tagPositions);
    
    if (mongoURI) {
        const allBays = await Bay.find({}).sort({ id: 1 });
        socket.emit('bays_updated', allBays);
    }

    // --- SỰ KIỆN: CẬP NHẬT ĐỘ CAO ---
    socket.on('set_height_config', async (newConfig) => {
        if (userRole !== 'admin') return;
        heightConfig = {
            anchorHeight: parseFloat(newConfig.anchorHeight),
            tagHeight: parseFloat(newConfig.tagHeight)
        };
        console.log("🛠️ Cập nhật độ cao:", heightConfig);
        if (mongoURI) {
            await Config.findOneAndUpdate(
                { type: 'height_settings' }, 
                { type: 'height_settings', data: [heightConfig] }, 
                { upsert: true, new: true }
            );
        }
        io.emit('height_config_update', heightConfig);
    });

    // --- [MỚI] SỰ KIỆN: CẬP NHẬT KÍCH THƯỚC MAP ---
    socket.on('set_map_dimensions', async (dims) => {
        if (userRole !== 'admin') return;
        
        mapDimensions = {
            width: parseFloat(dims.width),
            length: parseFloat(dims.length)
        };
        console.log("📏 Cập nhật kích thước kho:", mapDimensions);

        if (mongoURI) {
            await Config.findOneAndUpdate(
                { type: 'map_dimensions' }, 
                { type: 'map_dimensions', data: [mapDimensions] }, 
                { upsert: true, new: true }
            );
        }
        io.emit('map_dimensions_update', mapDimensions);
    });

    // --- CÁC SỰ KIỆN KHÁC ---
    socket.on('set_anchors', async (anchorPositions) => {
        if (userRole !== 'admin') return;
        anchors = anchorPositions;
        if (mongoURI) {
            await Config.findOneAndUpdate({ type: 'anchors' }, { type: 'anchors', data: anchors }, { upsert: true, new: true });
        }
        io.emit('anchors_updated', anchors);
    });

    socket.on('set_bays_layout', async (bays) => {
        if (userRole !== 'admin') return;
        if (mongoURI) {
            await Bay.deleteMany({});
            if (bays.length > 0) await Bay.insertMany(bays);
            const updatedBays = await Bay.find({}).sort({ id: 1 });
            io.emit('bays_updated', updatedBays);
        }
    });

    socket.on('update_bay_data', async (updatedBay) => {
        if (mongoURI) {
            await Bay.findOneAndUpdate({ id: updatedBay.id }, updatedBay);
            const allBays = await Bay.find({}).sort({ id: 1 });
            io.emit('bays_updated', allBays);
        }
    });
});


// --- 7. MQTT (HIVEMQ CLUSTER BẢO MẬT) ---
const MQTT_HOST = 'ac283ced08d54c199286b8bdb567f195.s1.eu.hivemq.cloud';
const MQTT_PORT = 8883;
const MQTT_USER = 'smart_warehouse';
const MQTT_PASS = 'Thuan@06032006';

const MQTT_TOPIC_PREFIX = 'kho_thong_minh/tags/';
const MQTT_TOPIC_WILDCARD = MQTT_TOPIC_PREFIX + '+';

console.log(`⏳ Đang kết nối MQTT Cluster: ${MQTT_HOST}...`);

const client = mqtt.connect(`mqtts://${MQTT_HOST}`, {
    port: MQTT_PORT,
    username: MQTT_USER,
    password: MQTT_PASS,
    protocol: 'mqtts', 
    rejectUnauthorized: true 
});

client.on('connect', () => {
    console.log('✅ Server đã kết nối HiveMQ Cluster thành công!');
    client.subscribe(MQTT_TOPIC_WILDCARD);
});

client.on('error', (err) => {
    console.error('❌ Lỗi MQTT:', err.message);
});

client.on('message', (topic, message) => {
    if (topic.startsWith(MQTT_TOPIC_PREFIX)) {
        try {
            const tagId = topic.split('/').pop(); 
            const data = JSON.parse(message.toString());
            const distanceData = data.distances; 

            if (anchors.length < 3) return;

            if (distanceData["0"] && distanceData["1"] && distanceData["2"]) {
                
                // --- 1. TÍNH TỶ LỆ DỰA TRÊN KÍCH THƯỚC WEB GỬI LÊN ---
                // Lấy chiều rộng từ biến mapDimensions (đã cập nhật từ web)
                const realW = mapDimensions.width > 0 ? mapDimensions.width : 10;
                
                // Công thức Scale: 800 pixel / Chiều rộng thực tế (m)
                const SCALE_FACTOR = SERVER_MAP_PIXEL_WIDTH / realW; 

                // --- 2. BÙ TRỪ ĐỘ CAO (PYTAGO) ---
                // Tính chênh lệch độ cao
                const H_DIFF = Math.abs(heightConfig.anchorHeight - heightConfig.tagHeight); 

                // Hàm Pytago
                function getHorizontalDistance(rawDistance) {
                    if (rawDistance <= H_DIFF) return 0; 
                    return Math.sqrt(Math.pow(rawDistance, 2) - Math.pow(H_DIFF, 2));
                }

                // --- 3. XỬ LÝ DỮ LIỆU ---
                const p1 = anchors[0]; 
                const p2 = anchors[1]; 
                const p3 = anchors[2]; 

                // Áp dụng Pytago cho các khoảng cách thô
                const d1_floor = getHorizontalDistance(distanceData["0"]);
                const d2_floor = getHorizontalDistance(distanceData["1"]);
                const d3_floor = getHorizontalDistance(distanceData["2"]);

                // Đổi ra Pixel để vẽ
                const r1 = d1_floor * SCALE_FACTOR;
                const r2 = d2_floor * SCALE_FACTOR;
                const r3 = d3_floor * SCALE_FACTOR;

                // Tính toán vị trí (x, y)
                const position = trilaterate(p1, p2, p3, r1, r2, r3);

                if (position) {
                    tagPositions[tagId] = position;
                    io.emit('tags_update', tagPositions);
                }
            }
        } catch (e) {
            console.error("Lỗi xử lý:", e.message);
        }
    }
});

// --- HÀM TOÁN HỌC TRILATERATION ---
function trilaterate(p1, p2, p3, r1, r2, r3) {
    try {
        const A = 2 * p2.x - 2 * p1.x;
        const B = 2 * p2.y - 2 * p1.y;
        const C = r1**2 - r2**2 - p1.x**2 + p2.x**2 - p1.y**2 + p2.y**2;
        const D = 2 * p3.x - 2 * p2.x;
        const E = 2 * p3.y - 2 * p2.y;
        const F = r2**2 - r3**2 - p2.x**2 + p3.x**2 - p2.y**2 + p3.y**2;
        
        const x = (C * E - F * B) / (E * A - B * D);
        const y = (C * A - F * D) / (B * A - D * E);
        
        if (isNaN(x) || isNaN(y)) return null;
        return { x, y };
    } catch { return null; }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
