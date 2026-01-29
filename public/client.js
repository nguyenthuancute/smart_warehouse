// --- KHỞI TẠO BIẾN TOÀN CỤC ---
// Lưu ý: 'socket' đã được khai báo ở bên index.html nên ta dùng trực tiếp
const canvas = document.getElementById('warehouseCanvas');
const ctx = canvas.getContext('2d');
const mapUploader = document.getElementById('mapUploader');
const loadingText = document.getElementById('loadingText');

// Các biến trạng thái
let mapImage = new Image();
let isMapLoaded = false;
let anchors = [];
let tags = {};
let bays = [];

// Chế độ chỉnh sửa
let isAddingAnchorMode = false;
let isAddingBayMode = false;

// --- 1. XỬ LÝ TẢI BẢN ĐỒ (FIX LỖI CỦA BẠN) ---
mapUploader.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            mapImage.src = event.target.result;
            mapImage.onload = () => {
                // Khi ảnh tải xong, chỉnh kích thước Canvas bằng kích thước ảnh
                canvas.width = mapImage.width;
                canvas.height = mapImage.height;
                isMapLoaded = true;
                loadingText.style.display = 'none'; // Ẩn chữ "Vui lòng tải..."
                redrawCanvas(); // Vẽ lại ngay lập tức
            }
        };
        reader.readAsDataURL(file);
    }
});

// --- 2. LẮNG NGHE SOCKET TỪ SERVER ---
socket.on('anchors_updated', (data) => {
    anchors = data;
    redrawCanvas();
});

socket.on('tags_update', (data) => {
    tags = data;
    redrawCanvas();
});

socket.on('bays_updated', (data) => {
    bays = data;
    redrawCanvas();
});


// --- 3. HÀM VẼ (RENDER LOOP) ---
function redrawCanvas() {
    if (!isMapLoaded) return;

    // A. Xóa trắng & Vẽ bản đồ nền
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mapImage, 0, 0);

    // B. Vẽ Ô Kho (Bays)
    bays.forEach(bay => {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.3)'; // Màu xanh nhạt
        ctx.strokeStyle = 'green';
        ctx.fillRect(bay.x - 20, bay.y - 20, 40, 40); // Vẽ ô vuông 40x40
        ctx.strokeRect(bay.x - 20, bay.y - 20, 40, 40);
        
        ctx.fillStyle = 'black';
        ctx.font = '10px Arial';
        ctx.fillText("Bay " + bay.id, bay.x - 15, bay.y + 5);
    });

    // C. Vẽ Anchors (Trạm thu phát)
    anchors.forEach((anchor, index) => {
        // Vẽ vòng tròn xanh dương
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, 10, 0, 2 * Math.PI);
        ctx.fillStyle = '#007bff';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Ghi tên Anchor
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Arial';
        ctx.fillText("A" + (index + 1), anchor.x - 8, anchor.y + 4);
    });

    // D. Vẽ Tags (Chấm đỏ di chuyển)
    Object.keys(tags).forEach(tagId => {
        const pos = tags[tagId];
        if (pos) {
            // Vẽ chấm đỏ
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
            ctx.fillStyle = 'red';
            ctx.fill();
            
            // Vẽ viền tỏa sáng
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.stroke();

            // Ghi tên Tag
            ctx.fillStyle = 'black';
            ctx.font = 'bold 12px Arial';
            ctx.fillText(tagId.toUpperCase(), pos.x + 12, pos.y + 4);
        }
    });
}


// --- 4. XỬ LÝ CLICK CHUỘT (THÊM ANCHOR/BAY) ---
canvas.addEventListener('mousedown', (e) => {
    // Lấy tọa độ chuột chuẩn trên Canvas
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Mode 1: Thêm Anchor
    if (isAddingAnchorMode) {
        if (anchors.length >= 3) {
            alert("Hệ thống hiện tại chỉ hỗ trợ tối đa 3 Anchors!");
            return;
        }
        const newAnchor = { x: clickX, y: clickY };
        anchors.push(newAnchor);
        socket.emit('set_anchors', anchors); // Gửi về Server lưu
        redrawCanvas();
    }

    // Mode 2: Thêm Ô Kho
    if (isAddingBayMode) {
        // Tự động tạo ID mới
        const newId = bays.length > 0 ? Math.max(...bays.map(b => b.id)) + 1 : 1;
        const newBay = {
            id: newId,
            x: clickX,
            y: clickY,
            tiers: [] 
        };
        bays.push(newBay);
        socket.emit('set_bays_layout', bays); // Gửi về Server lưu
        redrawCanvas();
    }
});


// --- 5. CÁC NÚT ĐIỀU KHIỂN ---
// Nút Bật/Tắt chế độ sửa Anchor
document.getElementById('toggleAddAnchorModeButton').addEventListener('click', () => {
    isAddingAnchorMode = !isAddingAnchorMode;
    isAddingBayMode = false; // Tắt chế độ kia đi
    alert(isAddingAnchorMode ? "✏️ Đã BẬT chế độ đặt Anchor. Hãy click lên bản đồ!" : "Đã TẮT chế độ đặt Anchor.");
});

// Nút Đặt lại (Xóa hết) Anchor
document.getElementById('resetButton').addEventListener('click', () => {
    if (confirm("Bạn có chắc muốn xóa hết Anchors không?")) {
        anchors = [];
        socket.emit('set_anchors', []);
        redrawCanvas();
    }
});

// Nút Bật/Tắt chế độ sửa Ô Kho
document.getElementById('toggleAddBayModeButton').addEventListener('click', () => {
    isAddingBayMode = !isAddingBayMode;
    isAddingAnchorMode = false;
    alert(isAddingBayMode ? "📦 Đã BẬT chế độ thêm Ô kho. Hãy click lên bản đồ!" : "Đã TẮT chế độ thêm Ô kho.");
});
