require('dotenv').config(); 
const MongoStore = require('connect-mongo');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mqtt = require('mqtt');
// const trilateration = require('trilateration'); // Bỏ thư viện này, dùng hàm tự viết cho chuẩn
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose'); 
// --- BIẾN TOÀN CỤC ---
let anchors = []; 
let tagPositions = {};
// Mặc định: Anchor cao 2.5m, Tag cao 1.0m
let heightConfig = { anchorHeight: 2.5, tagHeight: 1.0 };

// --- 1. KẾT NỐI MONGODB ---
const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) {
    console.error("LỖI: Chưa cấu hình MONGO_URI trong file .env!");
    // process.exit(1); // Tạm comment để nếu lỗi DB vẫn chạy được server test MQTT
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
    }) : null, // Fallback nếu không có DB
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.json()); // Thêm dòng này để đọc JSON body

// --- 4. BIẾN TẠM (CACHE) ---
let anchors = []; 
let tagPositions = {};

// Hàm tải dữ liệu từ DB
async function loadDataFromDB() {
    if (!mongoURI) return;
    try {
        const anchorConfig = await Config.findOne({ type: 'anchors' });
        if (anchorConfig) anchors = anchorConfig.data;
        console.log(`📡 Đã tải ${anchors.length} anchor từ DB.`);
    } catch (e) { console.error("Lỗi tải dữ liệu:", e); }
}
loadDataFromDB();

// --- 5. ROUTE AUTHENTICATION (Giữ nguyên của bạn) ---
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
            // Backdoor để test nếu chưa nối DB
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
    socket.emit('height_config_update', heightConfig);

    // Lắng nghe lệnh thay đổi độ cao từ Admin
    socket.on('set_height_config', async (newConfig) => {
        if (userRole !== 'admin') return;
        
        // Cập nhật biến RAM
        heightConfig = {
            anchorHeight: parseFloat(newConfig.anchorHeight),
            tagHeight: parseFloat(newConfig.tagHeight)
        };
        
        console.log("🛠️ Cập nhật độ cao:", heightConfig);

        if (mongoURI) {
            // Lưu vào DB (Lưu dưới dạng mảng để khớp với Schema cũ)
            await Config.findOneAndUpdate(
                { type: 'height_settings' }, 
                { type: 'height_settings', data: [heightConfig] }, 
                { upsert: true, new: true }
            );
        }
        
        // Báo cho tất cả mọi người biết là cấu hình đã đổi
        io.emit('height_config_update', heightConfig);
    });
    console.log('🔌 Client Web đã kết nối');
    const session = socket.request.session;
    // Nếu muốn bypass login để test thì bỏ dòng dưới
    if (!session.user) { /* socket.disconnect(); return; */ } 
    const userRole = session.user ? session.user.role : 'admin';

    socket.emit('anchors_updated', anchors);
    socket.emit('tags_update', tagPositions);
    
    if (mongoURI) {
        const allBays = await Bay.find({}).sort({ id: 1 });
        socket.emit('bays_updated', allBays);
    }

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
// Cập nhật thông tin chính xác của bạn tại đây
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

// ... (Các phần kết nối bên trên giữ nguyên) ...

client.on('message', (topic, message) => {
    if (topic.startsWith(MQTT_TOPIC_PREFIX)) {
        try {
            const tagId = topic.split('/').pop(); 
            const data = JSON.parse(message.toString());
            const distanceData = data.distances; 

            if (anchors.length < 3) return;

            if (distanceData["0"] && distanceData["1"] && distanceData["2"]) {
                
                // --- 1. CẤU HÌNH TỶ LỆ & ĐỘ CAO (QUAN TRỌNG) ---
                
                const REAL_WIDTH_METERS = 5.53;  // Chiều rộng kho thực tế
                const MAP_IMAGE_WIDTH_PX = 800;  // Chiều rộng ảnh bản đồ (Pixel)
                const SCALE_FACTOR = MAP_IMAGE_WIDTH_PX / REAL_WIDTH_METERS; 

                // --- TÍNH NĂNG MỚI: BÙ TRỪ ĐỘ CAO (PYTAGO) ---
                // Hãy đo và nhập số liệu thực tế tại đây (đơn vị: Mét)
                const ANCHOR_HEIGHT = 2.5; // Ví dụ: Anchor treo cao 2.5m
                const TAG_HEIGHT = 1.0;    // Ví dụ: Tag để trên xe cao 1.0m
                
                // Cạnh góc vuông thẳng đứng (Chênh lệch độ cao)
                const H_DIFF = Math.abs(ANCHOR_HEIGHT - TAG_HEIGHT); 

                // Hàm Pytago: Tính cạnh góc vuông nằm ngang (Khoảng cách sàn)
                // Công thức: a = căn(c^2 - b^2)
                const H_DIFF = Math.abs(heightConfig.anchorHeight - heightConfig.tagHeight); 

                function getHorizontalDistance(rawDistance) {
                    if (rawDistance <= H_DIFF) return 0; // Nếu đo sai nhỏ hơn độ cao thì cho về 0
                    return Math.sqrt(Math.pow(rawDistance, 2) - Math.pow(H_DIFF, 2));
                }

                // --- 2. XỬ LÝ DỮ LIỆU ---
                const p1 = anchors[0]; 
                const p2 = anchors[1]; 
                const p3 = anchors[2]; 

                // Lấy khoảng cách thô (Cạnh huyền) từ cảm biến
                const d1_raw = distanceData["0"];
                const d2_raw = distanceData["1"];
                const d3_raw = distanceData["2"];

                // Áp dụng Pytago để lấy khoảng cách trên mặt sàn (Projected Distance)
                const d1_floor = getHorizontalDistance(d1_raw);
                const d2_floor = getHorizontalDistance(d2_raw);
                const d3_floor = getHorizontalDistance(d3_raw);

                // Đổi ra Pixel để vẽ
                const r1 = d1_floor * SCALE_FACTOR;
                const r2 = d2_floor * SCALE_FACTOR;
                const r3 = d3_floor * SCALE_FACTOR;

                // Log kiểm tra (Bạn có thể tắt đi khi chạy thật)
                // console.log(`Raw: ${d1_raw.toFixed(2)}m -> Floor: ${d1_floor.toFixed(2)}m (Diff: ${H_DIFF}m)`);

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
async function loadDataFromDB() {
    if (!mongoURI) return;
    try {
        // Tải Anchors
        const anchorConfig = await Config.findOne({ type: 'anchors' });
        if (anchorConfig) anchors = anchorConfig.data;

        // Tải Cấu hình Độ cao (MỚI)
        const hConfig = await Config.findOne({ type: 'height_settings' });
        if (hConfig && hConfig.data && hConfig.data.length > 0) {
            heightConfig = hConfig.data[0]; // Lưu dạng mảng [ {anchorHeight:..., tagHeight:...} ]
        }
        
        console.log(`📡 Đã tải dữ liệu. Anchor Height: ${heightConfig.anchorHeight}m, Tag Height: ${heightConfig.tagHeight}m`);
    } catch (e) { console.error("Lỗi tải dữ liệu:", e); }
}
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
