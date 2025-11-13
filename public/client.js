// Biến toàn cục để lưu trữ vai trò user
let USER_ROLE = null;

// Kết nối với máy chủ Socket.io
const socket = io();

// --- 1. LẤY CÁC PHẦN TỬ HTML ---
const mapUploader = document.getElementById('mapUploader');
const canvas = document.getElementById('warehouseCanvas');
const ctx = canvas.getContext('2d');
// ... (lấy tất cả các phần tử như code cũ) ...
const toggleAddAnchorModeButton = document.getElementById('toggleAddAnchorModeButton');
const toggleAddBayModeButton = document.getElementById('toggleAddBayModeButton');
// ... (lấy tất cả các phần tử pop-up như code cũ) ...
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
const bayTier1_ro_code = document.getElementById('bayTier1_ro_code');
const bayTier1_ro_status = document.getElementById('bayTier1_ro_status');
const bayTier2_ro_code = document.getElementById('bayTier2_ro_code');
const bayTier2_ro_status = document.getElementById('bayTier2_ro_status');
const bayTier3_ro_code = document.getElementById('bayTier3_ro_code');
const bayTier3_ro_status = document.getElementById('bayTier3_ro_status');
const loadingText = document.getElementById('loadingText');
const resetButton = document.getElementById('resetButton');
const instructions = document.getElementById('instructions');
const anchorStatus = document.getElementById('anchorStatus');

// --- 2. BIẾN TOÀN CỤC ---
let mapImage = new Image();
let mapLoaded = false;
let anchors = []; 
let allTagPositions = {}; 
let warehouseBays = []; 
let zoom = 1;       
let originX = 0;    
let originY = 0;    
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let hasRotated = false; 
let hasPanned = false; 
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

// --- 4. TẢI VÀ XỬ LÝ BẢN ĐỒ (Giữ nguyên) ---
mapUploader.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        // ... (Toàn bộ logic xoay ảnh giữ nguyên) ...
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

// Hàm "Fit" ảnh
function fitImageToCanvas() {
    // ... (Giữ nguyên code) ...
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

// --- 5. VẼ LẠI MỌI THỨ (Giữ nguyên) ---
function redrawCanvas() {
    // ... (Toàn bộ logic vẽ giữ nguyên y hệt code cũ) ...
    if (!mapLoaded) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mapImage, originX, originY, mapImage.width * zoom, mapImage.height * zoom);
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
    if (isAddingBays) {
        warehouseBays.forEach(bay => {
            const scaledX = (bay.x * zoom) + originX;
            const scaledY = (bay.y * zoom) + originY;
            ctx.strokeStyle = '#6f42c1'; 
            ctx.lineWidth = 1;
            ctx.strokeRect(scaledX - 10, scaledY - 10, 20, 20); 
            drawText(`Ô ${bay.id}`, scaledX, scaledY + 20, '#6f42c1');
            const isOccupied = bay.tiers.some(tier => tier.occupied);
            if (isOccupied) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; 
                ctx.fillRect(scaledX - 10, scaledY - 10, 20, 20);
            }
        });
    }
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

// --- 6. LOGIC TƯƠNG TÁC (CLICK, PAN, ZOOM) ---

// A. Đặt Anchor / Ô Kho (Click)
canvas.addEventListener('click', (event) => {
    // ... (Logic click giữ nguyên) ...
    if (!mapLoaded || hasPanned) { hasPanned = false; return; }
    const rect = canvas.getBoundingClientRect();
    const clickX_on_canvas = event.clientX - rect.left;
    const clickY_on_canvas = event.clientY - rect.top;
    const originalX = (clickX_on_canvas - originX) / zoom;
    const originalY = (clickY_on_canvas - originY) / zoom;
    if (originalX < 0 || originalX > mapImage.width || originalY < 0 || originalY > mapImage.height) return; 

    // Logic thêm Anchor (Chỉ admin mới vào được mode này)
    if (isAddingAnchors) {
        if (anchors.length >= 12) { alert('Đã đặt đủ 12 anchor.'); return; }
        anchors.push({ x: originalX, y: originalY });
        updateAnchorStatusDisplay(); 
        redrawCanvas(); 
    }
    
    // Logic thêm Ô Kho (Chỉ admin mới vào được mode này)
    if (isAddingBays) {
        const newBay = {
            id: warehouseBays.length + 1, x: originalX, y: originalY,
            tiers: [ { code: '', occupied: false }, { code: '', occupied: false }, { code: '', occupied: false } ]
        };
        warehouseBays.push(newBay);
        // THAY ĐỔI: Gửi event mới
        socket.emit('set_bays_layout', warehouseBays); 
        redrawCanvas();
    }
});

// B. Pan (Kéo thả) - (Giữ nguyên)
canvas.addEventListener('mousedown', (event) => {
    if (isAddingAnchors || isAddingBays) { isPanning = false; return; }
    isPanning = true;
    hasPanned = false; 
    lastPanX = event.clientX;
    lastPanY = event.clientY;
    canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('mouseup', () => {
    isPanning = false;
    if (!isAddingAnchors && !isAddingBays) canvas.style.cursor = 'grab';
});
canvas.addEventListener('mouseleave', () => {
    isPanning = false;
    if (!isAddingAnchors && !isAddingBays) canvas.style.cursor = 'grab';
});
canvas.addEventListener('mousemove', (event) => {
    if (!isPanning || !mapLoaded) return;
    if (isAddingAnchors || isAddingBays) return; 
    hasPanned = true; 
    const dx = event.clientX - lastPanX;
    const dy = event.clientY - lastPanY;
    originX += dx;
    originY += dy;
    lastPanX = event.clientX;
    lastPanY = event.clientY;
    redrawCanvas();
});

// C. Zoom (Cuộn chuột) - (Giữ nguyên)
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

// D. Mở Menu Chuột Phải (THAY ĐỔI LOGIC)
canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault(); 
    
    // Admin ở mode thêm anchor thì không làm gì
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
            targetBay = bay;
            break;
        }
    }
    
    if (targetBay) {
        currentEditingBayId = targetBay.id;
        
        // PHÂN QUYỀN POP-UP
        // Admin (ở mode sửa) VÀ Employee (luôn luôn) có thể sửa nội dung
        if (USER_ROLE === 'admin' || USER_ROLE === 'employee') {
            
            // Chỉ Admin mới được XÓA
            if (USER_ROLE === 'admin' && isAddingBays) {
                 bayContextMenu.classList.add('edit-mode');
                 bayContextMenu.classList.remove('view-mode');
                 deleteBayButton.style.display = 'inline-block'; // Admin có thể xóa
            } else {
                 // Employee chỉ được sửa, không được xóa
                 bayContextMenu.classList.add('edit-mode');
                 bayContextMenu.classList.remove('view-mode');
                 deleteBayButton.style.display = 'none'; // Employee KHÔNG thể xóa
            }

            bayIdTitle.innerText = targetBay.id;
            bayTier1Code.value = targetBay.tiers[0].code;
            bayTier1Occupied.checked = targetBay.tiers[0].occupied;
            bayTier2Code.value = targetBay.tiers[1].code;
            bayTier2Occupied.checked = targetBay.tiers[1].occupied;
            bayTier3Code.value = targetBay.tiers[2].code;
            bayTier3Occupied.checked = targetBay.tiers[2].occupied;
        } 
        
        bayContextMenu.style.display = 'block';
        bayContextMenu.style.left = `${event.clientX}px`;
        bayContextMenu.style.top = `${event.clientY}px`;
    }
});

// --- 7. CÁC HÀM TIỆN ÍCH VÀ SOCKET (THAY ĐỔI) ---

// Hàm tiện ích (Giữ nguyên)
function drawCircle(x, y, radius, color, lineWidth) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.stroke();
}
function drawText(text, x, y, color = '#000000') {
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
}

// Xử lý Nút Reset Anchor (Giữ nguyên)
resetButton.addEventListener('click', resetAnchors);
function resetAnchors() {
    if (!isAddingAnchors) return; 
    anchors = []; 
    updateAnchorStatusDisplay(); 
    redrawCanvas(); 
    instructions.innerText = 'Đã xóa. Hãy click để đặt lại (tối thiểu 3).';
}

// Cập nhật text (Giữ nguyên)
function updateAnchorStatusDisplay() {
    // ... (Giữ nguyên code) ...
    if (!isAddingAnchors) {
         anchorStatus.innerText = `Vị trí Anchor (pixel): ${anchors.length} điểm đã đặt (ẩn).`;
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

// Logic cho nút "Thêm Anchor" (THAY ĐỔI event)
toggleAddAnchorModeButton.addEventListener('click', () => {
    if (!mapLoaded) { alert("Vui lòng tải bản đồ trước!"); return; }
    if (isAddingBays) exitAddBayMode(); 
    isAddingAnchors = !isAddingAnchors; 
    if (isAddingAnchors) enterAddAnchorMode();
    else exitAddAnchorMode(true); // Thoát (Xác nhận) và Gửi server
});
function enterAddAnchorMode() { /* (Giữ nguyên) */ }
function exitAddAnchorMode(sendToServer) {
    // ... (logic cũ)
    isAddingAnchors = false;
    toggleAddAnchorModeButton.innerText = 'Sửa Vị trí Anchor';
    toggleAddAnchorModeButton.classList.remove('adding');
    resetButton.classList.remove('visible'); 
    instructions.innerText = 'Đã xác nhận. Nhấn "Sửa Vị trí" để thay đổi.';
    canvas.style.cursor = 'grab'; 
    
    // THAY ĐỔI: Gửi event 'set_anchors' (Admin-only)
    if(sendToServer && anchors.length >= 3) {
         socket.emit('set_anchors', anchors);
    } else if (sendToServer) {
        alert("Bạn cần đặt ít nhất 3 anchor!");
        enterAddAnchorMode(); // Quay lại mode thêm
        return;
    }
    
    updateAnchorStatusDisplay();
    redrawCanvas();
}


// LOGIC NÚT Ô KHO (Giữ nguyên)
toggleAddBayModeButton.addEventListener('click', () => {
    if (!mapLoaded) { alert("Vui lòng tải bản đồ trước!"); return; }
    if (isAddingAnchors) exitAddAnchorMode(false); 
    isAddingBays = !isAddingBays; 
    if (isAddingBays) enterAddBayMode();
    else exitAddBayMode();
});
function enterAddBayMode() { /* (Giữ nguyên) */ }
function exitAddBayMode() { /* (Giữ nguyên) */ }

// LOGIC MENU CHUỘT PHẢI (THAY ĐỔI event)
function hideContextMenu() {
    bayContextMenu.style.display = 'none';
    currentEditingBayId = null;
}
cancelBayDataButton.addEventListener('click', hideContextMenu);
closeBayDataButton.addEventListener('click', hideContextMenu); 

deleteBayButton.addEventListener('click', () => {
    if (currentEditingBayId === null) return;
    if (!confirm(`Bạn có chắc muốn XÓA vĩnh viễn Ô Kho ID: ${currentEditingBayId}?`)) {
        return; 
    }
    warehouseBays = warehouseBays.filter(bay => bay.id !== currentEditingBayId);
    warehouseBays.forEach((bay, index) => {
        bay.id = index + 1; // Đánh số lại
    });
    
    // THAY ĐỔI: Gửi event 'set_bays_layout' (Admin-only)
    socket.emit('set_bays_layout', warehouseBays); 
    hideContextMenu();
    redrawCanvas(); 
});

saveBayDataButton.addEventListener('click', () => {
    if (currentEditingBayId === null) return;
    const bay = warehouseBays.find(b => b.id === currentEditingBayId);
    if (!bay) return;
    
    // Cập nhật object 'bay'
    bay.tiers[0].code = bayTier1Code.value;
    bay.tiers[0].occupied = bayTier1Occupied.checked;
    bay.tiers[1].code = bayTier2Code.value;
    bay.tiers[1].occupied = bayTier2Occupied.checked;
    bay.tiers[2].code = bayTier3Code.value;
    bay.tiers[2].occupied = bayTier3Occupied.checked;
    
    // THAY ĐỔI: Gửi event 'update_bay_data' (Employee + Admin)
    socket.emit('update_bay_data', bay); 
    hideContextMenu();
    redrawCanvas(); 
});
// Đóng menu nếu click ra ngoài (Giữ nguyên)
document.addEventListener('click', (e) => {
    if (bayContextMenu.style.display === 'block' && !bayContextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// --- 8. LẮNG NGHE SERVER (Giữ nguyên) ---
socket.on('tags_update', (tagMap) => {
    allTagPositions = tagMap;
    redrawCanvas();
});
socket.on('anchors_updated', (serverAnchors) => {
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