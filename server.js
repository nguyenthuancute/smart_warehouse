const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mqtt = require('mqtt');
const trilateration = require('trilateration');
const path = require('path');

// --- THƯ VIỆN MỚI ---
const bodyParser = require('body-parser');
const session = require('express-session');

// --- 1. KHỞI TẠO APP VÀ SESSION ---
const app = express();
const server = http.createServer(app);

// Cấu hình session
const sessionMiddleware = session({
    secret: 'day-la-mot-chuoi-bi-mat-sieu-dai', // Thay đổi chuỗi này
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 } // 1 giờ
});

app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
// ... (Ngay sau dòng app.use(bodyParser.urlencoded({ extended: true }));)

// --- THÊM KHỐI CODE NÀY VÀO ---
// --- 2. CẤU HÌNH & "DATABASE" GIẢ ---

// Cấu hình MQTT
const MQTT_BROKER = 'mqtt://broker.hivemq.com';
const MQTT_TOPIC_PREFIX = 'kho_thong_minh/tags/';
const MQTT_TOPIC_WILDCARD = MQTT_TOPIC_PREFIX + '+';
// --- KẾT THÚC THÊM ---


// "DATABASE" GIẢ (LƯU TRONG BỘ NHỚ)
// CẢNH BÁO: Mất khi restart server. Chỉ dùng để demo.
// ... (phần còn lại của file)

// --- 2. "DATABASE" GIẢ (LƯU TRONG BỘ NHỚ) ---
// CẢNH BÁO: Mất khi restart server. Chỉ dùng để demo.
const users = [
    { username: 'admin', password: '1', role: 'admin' },
    { username: 'nv1', password: '1', role: 'employee' }
]; 
let anchors = [];
let tagPositions = {};
let warehouseBays = [];

// --- 3. LOGIC AUTHENTICATION (Đăng nhập / Đăng ký) ---

// Gửi file login.html
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Gửi file register.html
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Xử lý đăng ký
app.post('/register', (req, res) => {
    const { username, password, role } = req.body;
    
    // Kiểm tra xem user đã tồn tại chưa
    const userExists = users.find(u => u.username === username);
    if (userExists) {
        return res.send('Tên đăng nhập đã tồn tại. <a href="/register">Thử lại</a>');
    }
    
    // CẢNH BÁO: KHÔNG BAO GIỜ LÀM THẾ NÀY TRONG THỰC TẾ
    // Mật khẩu phải được hash (băm)
    const newUser = { username, password, role };
    users.push(newUser);
    
    console.log('User moi da dang ky:', newUser);
    console.log('Tat ca user:', users);
    
    res.redirect('/login'); // Đăng ký xong thì chuyển sang trang login
});

// Xử lý đăng nhập
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
        // Đăng nhập thành công! Lưu user vào session
        req.session.user = {
            username: user.username,
            role: user.role
        };
        req.session.save(); // Lưu lại
        console.log('User da dang nhap:', req.session.user);
        res.redirect('/'); // Chuyển hướng đến dashboard chính
    } else {
        res.send('Sai tên đăng nhập hoặc mật khẩu. <a href="/login">Thử lại</a>');
    }
});

// Xử lý đăng xuất
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/login'); // Đăng xuất xong về trang login
    });
});

// --- 4. BẢO VỆ TRANG DASHBOARD ---

// Middleware: Hàm kiểm tra xem đã đăng nhập chưa
function checkAuth(req, res, next) {
    if (req.session.user) {
        next(); // Đã đăng nhập, cho phép đi tiếp
    } else {
        res.redirect('/login'); // Chưa đăng nhập, bắt về trang login
    }
}

// Chỉ cho phép truy cập trang dashboard (/) NẾU ĐÃ ĐĂNG NHẬP
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cho phép truy cập các file tĩnh (css, js)
app.use(express.static('public'));

// Endpoint để client.js lấy thông tin user
app.get('/api/me', checkAuth, (req, res) => {
    res.json(req.session.user);
});


// --- 5. LOGIC SOCKET.IO (TÍCH HỢP SESSION VÀ PHÂN QUYỀN) ---
const io = new Server(server);

// Cho phép Socket.io truy cập session
io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

io.on('connection', (socket) => {
    console.log('Một người dùng đã kết nối qua Socket.io');
    
    // Lấy thông tin user từ session (nếu có)
    const session = socket.request.session;
    if (!session.user) {
        console.log('Socket ket noi nhung chua xac thuc!');
        socket.disconnect(); // Ngắt kết nối nếu chưa đăng nhập
        return;
    }
    const userRole = session.user.role;
    console.log(`User: ${session.user.username} (Role: ${userRole}) da ket noi socket.`);

    // --- GỬI DỮ LIỆU BAN ĐẦU ---
    socket.emit('anchors_updated', anchors);
    socket.emit('tags_update', tagPositions);
    socket.emit('bays_updated', warehouseBays);

    // --- LẮNG NGHE ANCHOR (CHỈ ADMIN) ---
    socket.on('set_anchors', (anchorPositions) => {
        // PHÂN QUYỀN: Chỉ admin được sửa anchor
        if (userRole !== 'admin') {
            console.log(`User ${session.user.username} (Employee) co gang sua anchor!`);
            return; 
        }
        
        anchors = anchorPositions;
        io.emit('anchors_updated', anchors);
    });
    
    // --- TÁCH LÀM 2 EVENT: set_bays_layout VÀ update_bay_data ---

    // 1. Chỉ Admin được thêm/xóa/sửa layout ô kho
    socket.on('set_bays_layout', (bays) => {
        // PHÂN QUYỀN: Chỉ admin
        if (userRole !== 'admin') {
            console.log(`User ${session.user.username} (Employee) co gang sua layout kho!`);
            return;
        }
        warehouseBays = bays;
        io.emit('bays_updated', warehouseBays); 
    });

    // 2. Cả Admin và Employee đều được cập nhật thông tin trong ô kho
    socket.on('update_bay_data', (updatedBay) => {
        const bay = warehouseBays.find(b => b.id === updatedBay.id);
        if (bay) {
            bay.tiers = updatedBay.tiers;
            console.log(`User ${session.user.username} da cap nhat O ${bay.id}`);
            io.emit('bays_updated', warehouseBays);
        }
    });
});

// --- 6. LOGIC MQTT (Giữ nguyên) ---
const client = mqtt.connect(MQTT_BROKER);
client.on('connect', () => {
    console.log('Đã kết nối tới MQTT Broker (dùng trilateration chia nhóm)');
    client.subscribe(MQTT_TOPIC_WILDCARD, (err) => {
        if (!err) {
            console.log(`Đã đăng ký nhận dữ liệu từ topic: ${MQTT_TOPIC_WILDCARD}`);
        }
    });
});

client.on('message', (topic, message) => {
    // ... (Toàn bộ logic MQTT chia nhóm giữ nguyên y hệt code cũ) ...
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
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Máy chủ (co Auth) đang chạy tại http://localhost:${PORT}`);
});