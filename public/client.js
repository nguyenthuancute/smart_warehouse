// Biến toàn cục để lưu trữ vai trò user
let USER_ROLE = null;

// Kết nối với máy chủ Socket.io
// Ép dùng websocket để phản hồi nhanh hơn
const socket = io({
    transports: ['websocket'], 
    upgrade: false
});

// --- 1. LẤY CÁC PHẦN TỬ HTML ---
const mapUploader = document.getElementById('mapUploader');
const canvas = document.getElementById('warehouseCanvas');
const ctx = canvas.getContext('2d');

// Các nút bấm chính
const toggleAddAnchorModeButton = document.getElementById('toggleAddAnchorModeButton');
const toggleAddBayModeButton = document.getElementById('toggleAddBayModeButton');
const resetButton = document.getElementById('resetButton'); // Nút đỏ

// Các phần tử thông báo
const loadingText = document.getElementById('loadingText');
const instructions = document.getElementById('instructions');
const anchorStatus = document.getElementById('anchorStatus');

// Các phần tử Menu Chuột phải (Pop-up)
const bayContextMenu = document.getElementById('bayContextMenu');
const bayIdTitle = document.getElementById('bayIdTitle');
const bayTier1Code = document.getElementById('bayTier1Code');
const bayTier1Occupied = document.getElementById('bayTier1Occupied');
const bayTier2Code = document.getElementById('bayTier2Code');
const bayTier2Occupied = document.getElementById('bayTier2Occupied');
const bayTier3Code = document.getElementById('bayTier3Code');
const bayTier3Occupied = document.getElementById('bayTier3Occupied');
const saveBayDataButton = document.getElementById('saveBayDataButton');
const cancelBayDataButton = document.getElementById('cancelBayDataButton');
const deleteBayButton = document.getElementById('deleteBayButton');
const closeBayDataButton = document.getElementById('closeBayDataButton');

// Các phần tử hiển thị (Read-only) trong Menu
const bayTier1_ro_code = document.getElementById('bayTier1_ro_code');
const bayTier1_ro_status = document.getElementById('bayTier1_ro_status');
const bayTier2_ro_code = document.getElementById('bayTier2_ro_code');
const bayTier2_ro_status = document.getElementById('bayTier2_ro_status');
const bayTier3_ro_code = document.getElementById('bayTier3_ro_code');
const bayTier3_ro_status = document.getElementById('bayTier3_ro_status');


// --- 2. BIẾN TOÀN CỤC ---
let mapImage = new Image();
let mapLoaded = false;
let anchors = []; 
let allTagPositions = {}; 
let warehouseBays = []; 

// Biến Zoom / Pan
let zoom = 1;       
let originX = 0;    
let originY = 0;    
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let hasRotated = false; 
let hasPanned = false; 

// Biến Trạng thái
let isAddingAnchors = false; 
let isAddingBays = false; 
let currentEditingBayId = null; 

// --- 3. KHỞI ĐỘNG: LẤY VAI TRÒ USER VÀ ẨN NÚT ---
window.onload = async () => {
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const user = await response.json();
            USER_ROLE = user.role;
            console.log('Đã lấy vai trò:', USER_ROLE);
            
            // PHÂN QUYỀN UI: Ẩn nút nếu là 'employee'
            if (USER_ROLE === 'employee') {
                toggleAddAnchorModeButton.style.display = 'none';
                toggleAddBayModeButton.style.display = 'none';
                resetButton.style.display = 'none';
            }
        } else {
            // Lỗi, có thể session hết hạn
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Loi khi lay thong tin user:', error);
        window.location.href = '/login';
    }
};

// --- 4. TẢI VÀ XỬ LÝ BẢN ĐỒ ---
mapUploader.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        hasRotated = false; 
        const reader = new FileReader();
        reader.onload = (e) => {
            mapImage.onload = () => {
                if (mapImage.height > mapImage.width && !hasRotated) {
                    hasRotated = true; 
                    const offscreenCanvas = document.createElement('canvas');
                    const offCtx = offscreenCanvas.getContext('2d');
                    offscreenCanvas.width = mapImage.height;
                    offscreenCanvas.height = mapImage.width;
                    offCtx.translate(mapImage.height, 0);
                    offCtx.rotate(Math.PI / 2);
                    offCtx.drawImage(mapImage, 0, 0);
                    mapImage.src = offscreenCanvas.toDataURL();
                    return; 
                }
                mapLoaded = true;
                loadingText.style.display = 'none';
                setTimeout(() => {
                    fitImageToCanvas();
                    // Reset trạng thái
                    if (isAddingAnchors) exitAddAnchorMode(false); 
                    if (isAddingBays) exitAddBayMode();
                }, 100); 
                window.onresize = fitImageToCanvas;
            };
            mapImage.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
});

function fitImageToCanvas() {
    if (!mapLoaded) return;
    const canvasElementWidth = canvas.clientWidth;
    const canvasElementHeight = canvas.clientHeight;
    canvas.width = canvasElementWidth;
    canvas.height = canvasElementHeight;
    const hRatio = canvas.width / mapImage.width;
    const vRatio = canvas.height / mapImage.height;
    const baseScale = Math.min(hRatio, vRatio);
    const baseOffsetX = (canvas.width - (mapImage.width * baseScale)) / 2;
    const baseOffsetY = (canvas.height - (mapImage.height * baseScale)) / 2;
    zoom = baseScale;
    originX = baseOffsetX;
    originY = baseOffsetY;
    redrawCanvas();
}

// --- 5. VẼ LẠI MỌI THỨ ---
function redrawCanvas() {
    if (!mapLoaded) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Vẽ bản đồ nền
    ctx.drawImage(mapImage, originX, originY, mapImage.width * zoom, mapImage.height * zoom);

    // 2. Vẽ Anchor (Chỉ hiện khi đang ở chế độ thêm Anchor)
    if (isAddingAnchors) {
        anchors.forEach((anchor, index) => {
            const scaledX = (anchor.x * zoom) + originX;
            const scaledY = (anchor.y * zoom) + originY;
            let color = '#007bff'; 
            if (index >= 3 && index < 6) color = '#ffc107'; 
            if (index >= 6 && index < 9) color = '#fd7e14'; 
            if (index >= 9) color = '#6f42c1'; 
            drawCircle(scaledX, scaledY, 5, color, 2); 
            drawText(`A${index + 1}`, scaledX, scaledY - 10, color);
        });
    }

    // 3. Vẽ Ô kho (Chỉ hiện khi đang ở chế độ thêm Ô kho HOẶC luôn hiện nếu muốn)
    // Ở đây mình để logic: Luôn hiện ô kho, nhưng chỉ hiện ID khi đang sửa
    warehouseBays.forEach(bay => {
        const scaledX = (bay.x * zoom) + originX;
        const scaledY = (bay.y * zoom) + originY;
        
        ctx.strokeStyle = '#6f42c1'; 
        ctx.lineWidth = 1;
        ctx.strokeRect(scaledX - 10, scaledY - 10, 20, 20); 
        
        // Nếu đang ở mode thêm ô, vẽ ID
        if (isAddingBays) {
            drawText(`Ô ${bay.id}`, scaledX, scaledY + 20, '#6f42c1');
        }
        
        // Tô màu đỏ nếu có hàng
        const isOccupied = bay.tiers.some(tier => tier.occupied);
        if (isOccupied) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; 
            ctx.fillRect(scaledX - 10, scaledY - 10, 20, 20);
        }
    });

    // 4. Vẽ Tag (Luôn hiện)
    for (const tagId in allTagPositions) {
        const position = allTagPositions[tagId];
        if (position) {
            const scaledX = (position.x * zoom) + originX;
            const scaledY = (position.y * zoom) + originY;
            drawCircle(scaledX, scaledY, 7, '#d9534f', 3); 
            drawText(tagId.toUpperCase(), scaledX, scaledY + 20, '#d9534f'); 
        }
    }
}

// --- 6. LOGIC TƯƠNG TÁC ---

// A. Click chuột (Thêm Anchor / Ô kho)
canvas.addEventListener('click', (event) => {
    if (!mapLoaded || hasPanned) { hasPanned = false; return; }
    
    const rect = canvas.getBoundingClientRect();
    const clickX_on_canvas = event.clientX - rect.left;
    const clickY_on_canvas = event.clientY - rect.top;
    const originalX = (clickX_on_canvas - originX) / zoom;
    const originalY = (clickY_on_canvas - originY) / zoom;

    if (originalX < 0 || originalX > mapImage.width || originalY < 0 || originalY > mapImage.height) return; 

    // Logic thêm Anchor
    if (isAddingAnchors) {
        if (anchors.length >= 12) { alert('Đã đặt đủ 12 anchor.'); return; }
        anchors.push({ x: originalX, y: originalY });
        updateAnchorStatusDisplay(); 
        redrawCanvas(); 
    }
    
    // Logic thêm Ô Kho
    if (isAddingBays) {
        const newBay = {
            id: warehouseBays.length + 1, x: originalX, y: originalY,
            tiers: [ { code: '', occupied: false }, { code: '', occupied: false }, { code: '', occupied: false } ]
        };
        warehouseBays.push(newBay);
        socket.emit('set_bays_layout', warehouseBays); 
        redrawCanvas();
    }
});

// B. Pan/Zoom (Giữ nguyên logic cũ)
canvas.addEventListener('mousedown', (event) => {
    if (isAddingAnchors || isAddingBays) { isPanning = false; return; }
    isPanning = true; hasPanned = false; 
    lastPanX = event.clientX; lastPanY = event.clientY;
    canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('mouseup', () => { isPanning = false; if (!isAddingAnchors && !isAddingBays) canvas.style.cursor = 'grab'; });
canvas.addEventListener('mouseleave', () => { isPanning = false; if (!isAddingAnchors && !isAddingBays) canvas.style.cursor = 'grab'; });
canvas.addEventListener('mousemove', (event) => {
    if (!isPanning || !mapLoaded) return;
    if (isAddingAnchors || isAddingBays) return; 
    hasPanned = true; 
    const dx = event.clientX - lastPanX;
    const dy = event.clientY - lastPanY;
    originX += dx; originY += dy;
    lastPanX = event.clientX; lastPanY = event.clientY;
    redrawCanvas();
});
canvas.addEventListener('wheel', (event) => {
    if (!mapLoaded) return;
    event.preventDefault(); 
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left; 
    const mouseY = event.clientY - rect.top;
    const imgX_before = (mouseX - originX) / zoom;
    const imgY_before = (mouseY - originY) / zoom;
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1; 
    const newZoom = zoom * zoomFactor;
    originX = mouseX - (imgX_before * newZoom);
    originY = mouseY - (imgY_before * newZoom);
    zoom = newZoom;
    redrawCanvas();
});

// C. Menu Chuột phải (Pop-up)
canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault(); 
    if (isAddingAnchors) return;
    
    const rect = canvas.getBoundingClientRect();
    const clickX_on_canvas = event.clientX - rect.left;
    const clickY_on_canvas = event.clientY - rect.top;
    const originalX = (clickX_on_canvas - originX) / zoom;
    const originalY = (clickY_on_canvas - originY) / zoom;
    const CLICK_THRESHOLD = 20 / zoom; 
    let targetBay = null;
    
    for (const bay of warehouseBays) {
        const dist = Math.sqrt(Math.pow(bay.x - originalX, 2) + Math.pow(bay.y - originalY, 2));
        if (dist < CLICK_THRESHOLD) {
            targetBay = bay; break;
        }
    }
    
    if (targetBay) {
        currentEditingBayId = targetBay.id;
        
        // Phân quyền hiển thị
        if (USER_ROLE === 'admin' || USER_ROLE === 'employee') {
            bayContextMenu.classList.add('edit-mode');
            bayContextMenu.classList.remove('view-mode');
            
            // Nút Xóa chỉ dành cho Admin
            if (USER_ROLE === 'admin' && isAddingBays) {
                 deleteBayButton.style.display = 'inline-block';
            } else {
                 deleteBayButton.style.display = 'none';
            }

            bayIdTitle.innerText = targetBay.id;
            bayTier1Code.value = targetBay.tiers[0].code; bayTier1Occupied.checked = targetBay.tiers[0].occupied;
            bayTier2Code.value = targetBay.tiers[1].code; bayTier2Occupied.checked = targetBay.tiers[1].occupied;
            bayTier3Code.value = targetBay.tiers[2].code; bayTier3Occupied.checked = targetBay.tiers[2].occupied;
        } 
        
        bayContextMenu.style.display = 'block';
        bayContextMenu.style.left = `${event.clientX}px`;
        bayContextMenu.style.top = `${event.clientY}px`;
    }
});

// --- 7. CÁC HÀM TIỆN ÍCH & NÚT BẤM (ĐÃ SỬA LỖI) ---

function drawCircle(x, y, radius, color, lineWidth) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
    ctx.lineWidth = lineWidth; ctx.strokeStyle = color; ctx.stroke();
}
function drawText(text, x, y, color = '#000000') {
    ctx.font = 'bold 16px Arial'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, x, y);
}

// === CÁC HÀM QUAN TRỌNG CHO ANCHOR ===

// Cập nhật dòng chữ hiển thị tọa độ
function updateAnchorStatusDisplay() {
    if (!isAddingAnchors) {
         anchorStatus.innerText = `Vị trí Anchor (pixel): ${anchors.length} điểm đã đặt.`;
         anchorStatus.style.background = '#eee'; 
         return;
    }
    anchorStatus.style.background = '#e6f7ff'; 
    if (anchors.length === 0) {
        anchorStatus.innerText = 'Vị trí Anchor (pixel):\nChưa đặt anchor nào.';
        return;
    }
    let text = 'Vị trí Anchor (pixel):\n';
    anchors.forEach((a, i) => {
        const roundedX = Math.round(a.x);
        const roundedY = Math.round(a.y);
        text += `A${i + 1}: (X: ${roundedX}, Y: ${roundedY})\n`;
    });
    anchorStatus.innerText = text;
}

// Nút Reset Anchor (Nút Đỏ)
resetButton.addEventListener('click', () => {
    if (!isAddingAnchors) return; 
    anchors = []; // Xóa hết
    updateAnchorStatusDisplay(); 
    redrawCanvas(); 
    instructions.innerText = 'Đã xóa. Hãy click để đặt lại (tối thiểu 3).';
});

// Nút Bật/Tắt chế độ sửa Anchor
toggleAddAnchorModeButton.addEventListener('click', () => {
    if (!mapLoaded) { alert("Vui lòng tải bản đồ trước!"); return; }
    
    // Nếu đang ở chế độ sửa kho thì tắt đi
    if (isAddingBays) exitAddBayMode(); 
    
    isAddingAnchors = !isAddingAnchors; 
    
    if (isAddingAnchors) {
        enterAddAnchorMode();
    } else {
        exitAddAnchorMode(true); // Thoát và Gửi server
    }
});

function enterAddAnchorMode() {
    isAddingAnchors = true;
    toggleAddAnchorModeButton.innerText = 'Xác nhận Vị trí Anchor';
    toggleAddAnchorModeButton.classList.add('adding');
    
    // HIỆN NÚT ĐỎ RESET
    resetButton.classList.add('visible'); 
    resetButton.style.display = 'block'; // Ép hiển thị

    instructions.innerText = 'Click lên bản đồ để đặt anchor (tối thiểu 3). Nhấn nút Đỏ để xóa làm lại.';
    canvas.style.cursor = 'crosshair'; 
    
    updateAnchorStatusDisplay();
    redrawCanvas();
}

function exitAddAnchorMode(sendToServer) {
    // Kiểm tra nếu chưa đủ 3 điểm thì không cho thoát (nếu định gửi server)
    if(sendToServer && anchors.length > 0 && anchors.length < 3) {
        alert("Bạn cần đặt ít nhất 3 anchor!");
        // Quay lại mode thêm
        enterAddAnchorMode();
        return;
    }

    isAddingAnchors = false;
    toggleAddAnchorModeButton.innerText = 'Sửa Vị trí Anchor';
    toggleAddAnchorModeButton.classList.remove('adding');
    
    // ẨN NÚT ĐỎ RESET
    resetButton.classList.remove('visible'); 
    resetButton.style.display = 'none';

    instructions.innerText = 'Đã xác nhận. Nhấn "Sửa Vị trí" để thay đổi.';
    canvas.style.cursor = 'grab'; 
    
    // Gửi lên server
    if(sendToServer) {
         socket.emit('set_anchors', anchors);
    }
    
    updateAnchorStatusDisplay();
    redrawCanvas();
}


// === CÁC HÀM QUAN TRỌNG CHO Ô KHO ===

toggleAddBayModeButton.addEventListener('click', () => {
    if (!mapLoaded) { alert("Vui lòng tải bản đồ trước!"); return; }
    if (isAddingAnchors) exitAddAnchorMode(false); 
    isAddingBays = !isAddingBays; 
    if (isAddingBays) enterAddBayMode(); else exitAddBayMode();
});

function enterAddBayMode() {
    isAddingBays = true;
    toggleAddBayModeButton.innerText = 'Thoát Chế độ Thêm Ô';
    toggleAddBayModeButton.classList.add('adding');
    instructions.innerText = 'Click để TẠO ô kho. Nhấp chuột phải để SỬA/XÓA.';
    canvas.style.cursor = 'cell'; 
    redrawCanvas(); 
}

function exitAddBayMode() {
    isAddingBays = false;
    toggleAddBayModeButton.innerText = 'Thêm/Sửa Ô Kho';
    toggleAddBayModeButton.classList.remove('adding');
    instructions.innerText = 'Nhấp chuột phải vào ô kho để XEM/SỬA thông tin.';
    canvas.style.cursor = 'grab';
    redrawCanvas(); 
}

// === XỬ LÝ MENU POP-UP ===
function hideContextMenu() {
    bayContextMenu.style.display = 'none';
    currentEditingBayId = null;
}
cancelBayDataButton.addEventListener('click', hideContextMenu);
closeBayDataButton.addEventListener('click', hideContextMenu); 

deleteBayButton.addEventListener('click', () => {
    if (currentEditingBayId === null) return;
    if (!confirm(`Bạn có chắc muốn XÓA vĩnh viễn Ô Kho ID: ${currentEditingBayId}?`)) return; 
    warehouseBays = warehouseBays.filter(bay => bay.id !== currentEditingBayId);
    warehouseBays.forEach((bay, index) => { bay.id = index + 1; });
    socket.emit('set_bays_layout', warehouseBays); 
    hideContextMenu();
    redrawCanvas(); 
});

saveBayDataButton.addEventListener('click', () => {
    if (currentEditingBayId === null) return;
    const bay = warehouseBays.find(b => b.id === currentEditingBayId);
    if (!bay) return;
    bay.tiers[0].code = bayTier1Code.value; bay.tiers[0].occupied = bayTier1Occupied.checked;
    bay.tiers[1].code = bayTier2Code.value; bay.tiers[1].occupied = bayTier2Occupied.checked;
    bay.tiers[2].code = bayTier3Code.value; bay.tiers[2].occupied = bayTier3Occupied.checked;
    socket.emit('update_bay_data', bay); 
    hideContextMenu();
    redrawCanvas(); 
});
document.addEventListener('click', (e) => {
    if (bayContextMenu.style.display === 'block' && !bayContextMenu.contains(e.target)) hideContextMenu();
});

// --- 8. LẮNG NGHE SERVER ---
socket.on('tags_update', (tagMap) => {
    allTagPositions = tagMap;
    redrawCanvas();
});
socket.on('anchors_updated', (serverAnchors) => {
    // Chỉ cập nhật từ server nếu mình KHÔNG đang sửa.
    // Nếu đang sửa thì ưu tiên cái mình đang vẽ.
    if (!isAddingAnchors) { 
        anchors = serverAnchors;
        updateAnchorStatusDisplay(); 
        redrawCanvas(); 
    }
});
socket.on('bays_updated', (serverBays) => {
    if (currentEditingBayId === null) {
        warehouseBays = serverBays;
        redrawCanvas();
    }
});
