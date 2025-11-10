// Kết nối với máy chủ Socket.io
const socket = io();

// --- 1. LẤY CÁC PHẦN TỬ HTML ---
const mapUploader = document.getElementById('mapUploader');
const canvas = document.getElementById('warehouseCanvas');
const ctx = canvas.getContext('2d');
const loadingText = document.getElementById('loadingText');
const resetButton = document.getElementById('resetButton');
const instructions = document.getElementById('instructions');
const toggleAddAnchorModeButton = document.getElementById('toggleAddAnchorModeButton');
const anchorStatus = document.getElementById('anchorStatus');

// --- LẤY CÁC PHẦN TỬ Ô KHO ---
const toggleAddBayModeButton = document.getElementById('toggleAddBayModeButton');
const bayContextMenu = document.getElementById('bayContextMenu');
const bayIdTitle = document.getElementById('bayIdTitle');
// Sửa
const bayTier1Code = document.getElementById('bayTier1Code');
const bayTier1Occupied = document.getElementById('bayTier1Occupied');
const bayTier2Code = document.getElementById('bayTier2Code');
const bayTier2Occupied = document.getElementById('bayTier2Occupied');
const bayTier3Code = document.getElementById('bayTier3Code');
const bayTier3Occupied = document.getElementById('bayTier3Occupied');
const saveBayDataButton = document.getElementById('saveBayDataButton');
const cancelBayDataButton = document.getElementById('cancelBayDataButton');
const deleteBayButton = document.getElementById('deleteBayButton');
// Xem
const closeBayDataButton = document.getElementById('closeBayDataButton');
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

// --- LOGIC ZOOM/PAN VÀ XOAY ẢNH ---
let zoom = 1;       
let originX = 0;    
let originY = 0;    
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let hasRotated = false; 
let hasPanned = false; 

// --- BIẾN TRẠNG THÁI ---
let isAddingAnchors = false; // Chế độ thêm anchor
let isAddingBays = false; // Chế độ thêm ô kho
let currentEditingBayId = null; // ID của ô kho đang sửa

// --- 3. TẢI VÀ XỬ LÝ BẢN ĐỒ ---
mapUploader.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        hasRotated = false; 
        const reader = new FileReader();
        reader.onload = (e) => {
            mapImage.onload = () => {
                // Logic xoay ảnh
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
                    if (isAddingAnchors) exitAddAnchorMode(false); // Thoát mode (không gửi server)
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

// --- 4. VẼ LẠI MỌI THỨ ---
function redrawCanvas() {
    if (!mapLoaded) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mapImage, originX, originY, mapImage.width * zoom, mapImage.height * zoom);

    // Vẽ 12 anchor (chỉ khi đang ở chế độ thêm)
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

    // Vẽ các ô kho (chỉ khi ở chế độ thêm/sửa ô kho)
    if (isAddingBays) {  // <-- THÊM DÒNG NÀY
        warehouseBays.forEach(bay => {
            const scaledX = (bay.x * zoom) + originX;
            const scaledY = (bay.y * zoom) + originY;
            
            ctx.strokeStyle = '#6f42c1'; 
            ctx.lineWidth = 1;
            ctx.strokeRect(scaledX - 10, scaledY - 10, 20, 20); 
            
            if (isAddingBays) { // Dòng này giờ có thể bỏ if, nhưng để cũng không sao
                drawText(`Ô ${bay.id}`, scaledX, scaledY + 20, '#6f42c1');
            }
            
            const isOccupied = bay.tiers.some(tier => tier.occupied);
            if (isOccupied) {
                ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; 
                ctx.fillRect(scaledX - 10, scaledY - 10, 20, 20);
            }
        });
    } // <-- THÊM DÒNG NÀY

    // Vẽ 4 tag (luôn luôn vẽ)
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

// --- 5. LOGIC TƯƠNG TÁC (CLICK, PAN, ZOOM) ---

// A. Đặt Anchor / Ô Kho (Click)
canvas.addEventListener('click', (event) => {
    if (!mapLoaded || hasPanned) { 
        hasPanned = false; 
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const clickX_on_canvas = event.clientX - rect.left;
    const clickY_on_canvas = event.clientY - rect.top;
    const originalX = (clickX_on_canvas - originX) / zoom;
    const originalY = (clickY_on_canvas - originY) / zoom;

    if (originalX < 0 || originalX > mapImage.width || originalY < 0 || originalY > mapImage.height) return; 

    // 1. Logic thêm Anchor
    if (isAddingAnchors) {
        if (anchors.length >= 12) {
            alert('Đã đặt đủ 12 anchor.'); return;
        }
        anchors.push({ x: originalX, y: originalY });
        updateAnchorStatusDisplay(); 
        redrawCanvas(); 
    }
    
    // 2. Logic thêm Ô Kho
    if (isAddingBays) {
        const newBay = {
            id: warehouseBays.length + 1,
            x: originalX, y: originalY,
            tiers: [
                { code: '', occupied: false },
                { code: '', occupied: false },
                { code: '', occupied: false }
            ]
        };
        warehouseBays.push(newBay);
        socket.emit('set_bays', warehouseBays);
        redrawCanvas();
    }
});

// B. Pan (Kéo thả)
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

// C. Zoom (Cuộn chuột)
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

// D. Mở Menu Chuột Phải
canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault(); 
    
    // Không cho mở menu khi đang ở chế độ thêm ANCHOR
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
        // Đã tìm thấy ô kho
        currentEditingBayId = targetBay.id;
        
        if (isAddingBays) {
            // --- 1. Mở CHẾ ĐỘ SỬA ---
            bayContextMenu.classList.add('edit-mode');
            bayContextMenu.classList.remove('view-mode');
            bayIdTitle.innerText = targetBay.id;
            bayTier1Code.value = targetBay.tiers[0].code;
            bayTier1Occupied.checked = targetBay.tiers[0].occupied;
            bayTier2Code.value = targetBay.tiers[1].code;
            bayTier2Occupied.checked = targetBay.tiers[1].occupied;
            bayTier3Code.value = targetBay.tiers[2].code;
            bayTier3Occupied.checked = targetBay.tiers[2].occupied;
        } else {
            // --- 2. Mở CHẾ ĐỘ XEM ---
            bayContextMenu.classList.remove('edit-mode');
            bayContextMenu.classList.add('view-mode');
            bayIdTitle.innerText = targetBay.id;
            bayTier1_ro_code.innerText = targetBay.tiers[0].code || "(Trống)";
            bayTier1_ro_status.innerText = targetBay.tiers[0].occupied ? "Đã chiếm" : "Chưa chiếm";
            bayTier2_ro_code.innerText = targetBay.tiers[1].code || "(Trống)";
            bayTier2_ro_status.innerText = targetBay.tiers[1].occupied ? "Đã chiếm" : "Chưa chiếm";
            bayTier3_ro_code.innerText = targetBay.tiers[2].code || "(Trống)";
            bayTier3_ro_status.innerText = targetBay.tiers[2].occupied ? "Đã chiếm" : "Chưa chiếm";
        }
        
        bayContextMenu.style.display = 'block';
        bayContextMenu.style.left = `${event.clientX}px`;
        bayContextMenu.style.top = `${event.clientY}px`;
    }
});

// --- 6. CÁC HÀM TIỆN ÍCH VÀ SOCKET ---

// Hàm tiện ích để vẽ
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

// Xử lý Nút Reset Anchor
resetButton.addEventListener('click', resetAnchors);
function resetAnchors() {
    if (!isAddingAnchors) return; 
    anchors = []; 
    updateAnchorStatusDisplay(); 
    redrawCanvas(); 
    instructions.innerText = 'Đã xóa. Hãy click để đặt lại (tối thiểu 3).';
}

// Cập nhật text hiển thị
function updateAnchorStatusDisplay() {
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

// Logic cho nút "Thêm Anchor"
toggleAddAnchorModeButton.addEventListener('click', () => {
    if (!mapLoaded) { alert("Vui lòng tải bản đồ trước!"); return; }
    if (isAddingBays) exitAddBayMode(); // Thoát mode kia nếu đang bật
    isAddingAnchors = !isAddingAnchors; 
    if (isAddingAnchors) enterAddAnchorMode();
    else exitAddAnchorMode(true); // Thoát (Xác nhận) và Gửi server
});

function enterAddAnchorMode() {
    isAddingAnchors = true;
    toggleAddAnchorModeButton.innerText = 'Xác nhận Vị trí Anchor';
    toggleAddAnchorModeButton.classList.add('adding');
    resetButton.classList.add('visible'); 
    instructions.innerText = 'Click lên bản đồ để đặt anchor (tối thiểu 3).';
    canvas.style.cursor = 'crosshair'; 
    updateAnchorStatusDisplay();
    redrawCanvas();
}
function exitAddAnchorMode(sendToServer) {
    if (sendToServer && anchors.length < 3) {
        alert("Bạn cần đặt ít nhất 3 anchor!");
        return; 
    }
    isAddingAnchors = false;
    toggleAddAnchorModeButton.innerText = 'Sửa Vị trí Anchor';
    toggleAddAnchorModeButton.classList.remove('adding');
    resetButton.classList.remove('visible'); 
    instructions.innerText = 'Đã xác nhận. Nhấn "Sửa Vị trí" để thay đổi.';
    canvas.style.cursor = 'grab'; 
    if(sendToServer) socket.emit('set_anchors', anchors);
    updateAnchorStatusDisplay();
    redrawCanvas();
}

// LOGIC NÚT Ô KHO
toggleAddBayModeButton.addEventListener('click', () => {
    if (!mapLoaded) { alert("Vui lòng tải bản đồ trước!"); return; }
    if (isAddingAnchors) exitAddAnchorMode(false); // Thoát mode kia (không gửi server)
    isAddingBays = !isAddingBays; 
    if (isAddingBays) enterAddBayMode();
    else exitAddBayMode();
});

function enterAddBayMode() {
    isAddingBays = true;
    toggleAddBayModeButton.innerText = 'Thoát Chế độ Thêm Ô';
    toggleAddBayModeButton.classList.add('adding');
    instructions.innerText = 'Click để TẠO ô kho. Nhấp chuột phải để SỬA/XÓA ô kho.';
    canvas.style.cursor = 'cell'; 
    redrawCanvas(); 
}
function exitAddBayMode() {
    isAddingBays = false;
    toggleAddBayModeButton.innerText = 'Thêm/Sửa Ô Kho';
    toggleAddBayModeButton.classList.remove('adding');
    instructions.innerText = 'Nhấp chuột phải vào ô kho để XEM thông tin.';
    canvas.style.cursor = 'grab';
    redrawCanvas(); 
}

// LOGIC MENU CHUỘT PHẢI
function hideContextMenu() {
    bayContextMenu.style.display = 'none';
    currentEditingBayId = null;
}
cancelBayDataButton.addEventListener('click', hideContextMenu);
closeBayDataButton.addEventListener('click', hideContextMenu); // Nút đóng mới

deleteBayButton.addEventListener('click', () => {
    if (currentEditingBayId === null) return;
    if (!confirm(`Bạn có chắc muốn XÓA vĩnh viễn Ô Kho ID: ${currentEditingBayId}?`)) {
        return; 
    }
    warehouseBays = warehouseBays.filter(bay => bay.id !== currentEditingBayId);
    warehouseBays.forEach((bay, index) => {
        bay.id = index + 1; // Đánh số lại
    });
    socket.emit('set_bays', warehouseBays);
    hideContextMenu();
    redrawCanvas(); 
});

saveBayDataButton.addEventListener('click', () => {
    if (currentEditingBayId === null) return;
    const bay = warehouseBays.find(b => b.id === currentEditingBayId);
    if (!bay) return;
    
    bay.tiers[0].code = bayTier1Code.value;
    bay.tiers[0].occupied = bayTier1Occupied.checked;
    bay.tiers[1].code = bayTier2Code.value;
    bay.tiers[1].occupied = bayTier2Occupied.checked;
    bay.tiers[2].code = bayTier3Code.value;
    bay.tiers[2].occupied = bayTier3Occupied.checked;
    
    socket.emit('set_bays', warehouseBays);
    hideContextMenu();
    redrawCanvas(); 
});
// Đóng menu nếu click ra ngoài
document.addEventListener('click', (e) => {
    if (bayContextMenu.style.display === 'block' && !bayContextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// --- 7. LẮNG NGHE SERVER ---
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