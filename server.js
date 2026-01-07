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

client.on('message', (topic, message) => {
    if (topic.startsWith(MQTT_TOPIC_PREFIX)) {
        try {
            const tagId = topic.split('/').pop(); // Lấy ID tag (vd: tag01)
            const data = JSON.parse(message.toString());
            const distanceData = data.distances; 

            // LOG KIỂM TRA DỮ LIỆU
            // console.log(`Data nhận được: Base0=${distanceData["0"]}, Base1=${distanceData["1"]}, Base2=${distanceData["2"]}`);

            // --- CẤU HÌNH MAP (MAPPING) ---
            // Yêu cầu của bạn:
            // Anchor 1 (trong mảng là index 0) <--> Base 0 (key "0")
            // Anchor 2 (trong mảng là index 1) <--> Base 1 (key "1")
            // Anchor 3 (trong mảng là index 2) <--> Base 2 (key "2")
            
            // Kiểm tra xem Admin đã đặt đủ 3 Anchor trên web chưa
            if (anchors.length < 3) {
                console.log("⚠️ Chưa đặt đủ Anchor trên bản đồ!");
                return;
            }

            // Kiểm tra xem có đủ dữ liệu từ 3 Base không
            // ... Bên trong client.on('message', ...)

            if (distanceData["0"] && distanceData["1"] && distanceData["2"]) {
                
                // --- CẤU HÌNH TỶ LỆ BẢN ĐỒ (QUAN TRỌNG) ---
                // 1. Nhập chiều rộng thực tế của kho (theo mét)
                const REAL_WIDTH_METERS = 5.53;  // Chiều ngang kho là 5m53
                
                // 2. Nhập chiều rộng của bức ảnh bản đồ bạn vẽ (theo Pixel)
                // Cách xem: Chuột phải vào file ảnh map -> Properties -> Details -> Xem dòng Dimensions (ví dụ 800x1500)
                const MAP_IMAGE_WIDTH_PX = 800; // <--- BẠN PHẢI SỬA SỐ NÀY ĐÚNG VỚI ẢNH CỦA BẠN

                // 3. Hệ thống tự tính tỷ lệ chuẩn
                const SCALE_FACTOR = MAP_IMAGE_WIDTH_PX / REAL_WIDTH_METERS; 
                
                // Log ra để kiểm tra xem 1 mét bằng bao nhiêu pixel
                // console.log("Tỷ lệ hiện tại: 1 mét =", SCALE_FACTOR, "pixels");

                // ... (Phần lấy tọa độ p1, p2, p3 và tính toán bên dưới giữ nguyên) ...
                const p1 = anchors[0]; 
                const p2 = anchors[1]; 
                const p3 = anchors[2]; 

                const r1 = distanceData["0"] * SCALE_FACTOR;
                const r2 = distanceData["1"] * SCALE_FACTOR;
                const r3 = distanceData["2"] * SCALE_FACTOR;

                const position = trilaterate(p1, p2, p3, r1, r2, r3);
                // ...
                if (position) {
                    // Gửi tọa độ pixel xuống Dashboard để vẽ
                    tagPositions[tagId] = position;
                    io.emit('tags_update', tagPositions);
                    
                    console.log(`📍 ${tagId} -> X: ${Math.round(position.x)}, Y: ${Math.round(position.y)}`);
                } else {
                    console.log("⚠️ Không tính được giao điểm (Các vòng tròn không cắt nhau)");
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
