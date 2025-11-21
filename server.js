require('dotenv').config(); // Đọc file .env
const MongoStore = require('connect-mongo');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mqtt = require('mqtt');
const trilateration = require('trilateration');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose'); // Thư viện Database

// --- 1. KẾT NỐI MONGODB ---
const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) {
    console.error("LỖI: Chưa cấu hình MONGO_URI trong file .env hoặc Render!");
    process.exit(1);
}

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Đã kết nối thành công tới MongoDB Atlas'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// --- 2. ĐỊNH NGHĨA SCHEMA (Cấu trúc dữ liệu) ---
// User
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'employee' }
});
const User = mongoose.model('User', UserSchema);

// Anchor (Lưu mảng 12 anchor dưới dạng 1 document duy nhất cho dễ quản lý)
const ConfigSchema = new mongoose.Schema({
    type: { type: String, unique: true }, // Ví dụ: 'anchors_config'
    data: Array
});
const Config = mongoose.model('Config', ConfigSchema);

// Warehouse Bays (Ô kho)
const BaySchema = new mongoose.Schema({
    id: Number,
    x: Number,
    y: Number,
    tiers: Array
});
const Bay = mongoose.model('Bay', BaySchema);


// --- 3. KHỞI TẠO APP ---
const app = express();
const server = http.createServer(app);
// --- CẤU HÌNH SESSION (Lưu vào MongoDB thay vì RAM) ---
// File: server.js
const sessionMiddleware = session({
    secret: 'secret-key-kho-thong-minh',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        ttl: 24 * 60 * 60, // 1 ngày
        
        // --- THÊM 2 DÒNG NÀY ĐỂ GIẢM LAG ---
        touchAfter: 24 * 3600, // Chỉ cập nhật session vào DB 1 lần mỗi 24h (trừ khi có thay đổi dữ liệu)
        autoRemove: 'native' // Để MongoDB tự động xóa session cũ, giảm tải cho Server
    }),
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- 4. BIẾN TẠM (CACHE) ---
// Vẫn giữ biến này để tính toán cho nhanh, nhưng sẽ đồng bộ với DB
let anchors = []; 
let tagPositions = {};

// Hàm tải dữ liệu từ DB khi khởi động
async function loadDataFromDB() {
    try {
        // Tải Anchors
        const anchorConfig = await Config.findOne({ type: 'anchors' });
        if (anchorConfig) anchors = anchorConfig.data;
        console.log(`Đã tải ${anchors.length} anchor từ DB.`);
    } catch (e) { console.error("Lỗi tải dữ liệu:", e); }
}
loadDataFromDB();


// --- 5. ROUTE AUTHENTICATION ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;
    try {
        // Kiểm tra trùng tên
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.send('Tên đăng nhập đã tồn tại. <a href="/register">Thử lại</a>');

        // Tạo user mới
        const newUser = new User({ username, password, role });
        await newUser.save();
        console.log('User mới đã đăng ký:', username);
        res.redirect('/login');
    } catch (e) {
        res.status(500).send("Lỗi server: " + e.message);
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username, password }); // Tìm trong DB
        if (user) {
            req.session.user = { username: user.username, role: user.role };
            req.session.save();
            res.redirect('/');
        } else {
            res.send('Sai tên đăng nhập hoặc mật khẩu. <a href="/login">Thử lại</a>');
        }
    } catch (e) {
        res.status(500).send("Lỗi server");
    }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// Middleware bảo vệ
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
    console.log('Socket kết nối');
    const session = socket.request.session;
    if (!session.user) { socket.disconnect(); return; }
    const userRole = session.user.role;

    // Gửi dữ liệu ban đầu từ DB
    socket.emit('anchors_updated', anchors);
    socket.emit('tags_update', tagPositions);
    
    // Lấy danh sách ô kho từ DB và gửi
    const allBays = await Bay.find({}).sort({ id: 1 });
    socket.emit('bays_updated', allBays);

    // --- SỰ KIỆN ANCHOR ---
    socket.on('set_anchors', async (anchorPositions) => {
        if (userRole !== 'admin') return;
        anchors = anchorPositions;
        
        // Lưu vào DB
        await Config.findOneAndUpdate(
            { type: 'anchors' }, 
            { type: 'anchors', data: anchors }, 
            { upsert: true, new: true }
        );
        
        io.emit('anchors_updated', anchors);
    });

    // --- SỰ KIỆN Ô KHO (Layout) ---
    socket.on('set_bays_layout', async (bays) => {
        if (userRole !== 'admin') return;
        
        // Xóa hết cũ, lưu mới (cách đơn giản nhất để đồng bộ vị trí/xóa)
        await Bay.deleteMany({});
        if (bays.length > 0) {
            await Bay.insertMany(bays);
        }
        
        const updatedBays = await Bay.find({}).sort({ id: 1 });
        io.emit('bays_updated', updatedBays);
    });

    // --- SỰ KIỆN Ô KHO (Update Data) ---
    socket.on('update_bay_data', async (updatedBay) => {
        // Cập nhật 1 ô kho cụ thể trong DB
        await Bay.findOneAndUpdate({ id: updatedBay.id }, updatedBay);
        
        // Gửi lại danh sách mới cho mọi người
        const allBays = await Bay.find({}).sort({ id: 1 });
        io.emit('bays_updated', allBays);
    });
});


// --- 7. MQTT ---
const MQTT_BROKER = 'mqtt://broker.hivemq.com';
const MQTT_TOPIC_PREFIX = 'kho_thong_minh/tags/';
const MQTT_TOPIC_WILDCARD = MQTT_TOPIC_PREFIX + '+';
const client = mqtt.connect(MQTT_BROKER);

client.on('connect', () => client.subscribe(MQTT_TOPIC_WILDCARD));
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
        } catch (e) {}
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
