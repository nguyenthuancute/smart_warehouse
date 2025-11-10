const mqtt = require('mqtt');

const MQTT_BROKER = 'mqtt://broker.hivemq.com';
const MQTT_TOPIC_PREFIX = 'kho_thong_minh/tags/';

// Vị trí "thật" của 12 anchor (khớp với file server trước)
const FAKE_ANCHORS = [
    { x: 50, y: 50 },   // A1 (index 0)
    { x: 450, y: 50 },  // A2 (index 1)
    { x: 250, y: 450 }, // A3 (index 2)
    
    { x: 50, y: 250 },  // A4 (index 3)
    { x: 450, y: 250 }, // A5 (index 4)
    { x: 250, y: 250 }, // A6 (index 5) - Vị trí mới (ở giữa)
    
    { x: 150, y: 150 }, // A7 (index 6)
    { x: 350, y: 150 }, // A8 (index 7)
    { x: 150, y: 350 }, // A9 (index 8)
    
    { x: 350, y: 350 }, // A10 (index 9)
    { x: 50, y: 450 },  // A11 (index 10)
    { x: 450, y: 450 }  // A12 (index 11)
];

// Định nghĩa 4 tag giả lập
const MOCK_TAGS = [
    { id: 'tag01', x: 100, y: 100, moveX: 2, moveY: 1.5 },
    { id: 'tag02', x: 400, y: 100, moveX: -1.5, moveY: 2 },
    { id: 'tag03', x: 100, y: 400, moveX: 1, moveY: -2 },
    { id: 'tag04', x: 400, y: 400, moveX: -2, moveY: -1 }
];

const client = mqtt.connect(MQTT_BROKER);

// Hàm tính khoảng cách (để code gọn hơn)
function getDistance(pos1, pos2) {
    return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
}

client.on('connect', () => {
    console.log('Mock Tag (4 tags, chia 4 nhóm) đã kết nối tới MQTT Broker');

    setInterval(() => {
        
        MOCK_TAGS.forEach((tag, tagIndex) => {
            // --- 1. Cập nhật vị trí "ảo" của từng tag ---
            tag.x += tag.moveX;
            tag.y += tag.moveY;
            if (tag.x > 480 || tag.x < 20) tag.moveX *= -1;
            if (tag.y > 480 || tag.y < 20) tag.moveY *= -1;

            // --- 2. Logic "CHIA NHÓM" ---
            // tagIndex 0 dùng anchor 0, 1, 2
            // tagIndex 1 dùng anchor 3, 4, 5
            // tagIndex 2 dùng anchor 6, 7, 8
            // tagIndex 3 dùng anchor 9, 10, 11
            
            const anchorIndexStart = tagIndex * 3; // 0, 3, 6, 9
            const i1 = anchorIndexStart;
            const i2 = anchorIndexStart + 1;
            const i3 = anchorIndexStart + 2;
            
            const noise = () => (Math.random() - 0.5) * 2;

            // --- 3. Tạo payload JSON theo định dạng MỚI ---
            // Gói tin chỉ chứa 3 khoảng cách, nhưng CHỈ RÕ là của anchor nào
            const distancesPayload = {};
            distancesPayload[i1] = getDistance(tag, FAKE_ANCHORS[i1]) + noise();
            distancesPayload[i2] = getDistance(tag, FAKE_ANCHORS[i2]) + noise();
            distancesPayload[i3] = getDistance(tag, FAKE_ANCHORS[i3]) + noise();
            
            const payload = JSON.stringify({
                distances: distancesPayload
            });
            
            const topic = MQTT_TOPIC_PREFIX + tag.id;

            // --- 4. Gửi đi ---
            client.publish(topic, payload, (err) => {
                if (err) {
                    console.error(`Gửi MQTT cho ${tag.id} thất bại:`, err);
                }
            });
        });
        console.log("Đã gửi dữ liệu 4 tags (đã chia nhóm).");

    }, 2000); // Gửi mỗi 2 giây
});