document.addEventListener("DOMContentLoaded", async function() {
    const NOTIFY_DATA_URL = '/data/notify.json';
    const NOTIFY_HTML_URL = '/components/notification.html';

    try {
        // 1. Tải dữ liệu thông báo
        const dataRes = await fetch(NOTIFY_DATA_URL);
        if (!dataRes.ok) return;
        const notifications = await dataRes.json();
        
        // Tìm thông báo đang bật
        const activeNotif = notifications.find(n => n.active === true);
        if (!activeNotif) return;

        // 2. Kiểm tra SessionStorage (Nếu đã xem trong phiên này rồi thì bỏ qua)
        const sessionKey = `popup_seen_${activeNotif.id}`;
        if (sessionStorage.getItem(sessionKey)) return;

        // 3. Tải và Inject HTML vào trang
        const htmlRes = await fetch(NOTIFY_HTML_URL);
        if (!htmlRes.ok) return;
        const htmlContent = await htmlRes.text();
        
        // Chèn HTML vào cuối body
        document.body.insertAdjacentHTML('beforeend', htmlContent);

        // 4. Điền nội dung
        const popup = document.getElementById('home-popup');
        const titleEl = document.getElementById('popup-title');
        const msgEl = document.getElementById('popup-message');
        const closeBtn = document.getElementById('popup-close-btn');

        if (popup && titleEl && msgEl) {
            titleEl.textContent = activeNotif.title;
            msgEl.innerHTML = activeNotif.message; // Hỗ trợ thẻ <br>

            // 5. Hiển thị Popup
            setTimeout(() => {
                popup.style.display = 'flex';
                // Force reflow
                popup.offsetHeight;
                popup.classList.add('show');
            }, 500);

            // 6. Xử lý đóng Popup
            const closePopup = () => {
                popup.classList.remove('show');
                setTimeout(() => {
                    popup.style.display = 'none';
                    popup.remove(); // Xóa luôn khỏi DOM cho nhẹ
                }, 300);
                // Lưu session để không hiện lại
                sessionStorage.setItem(sessionKey, 'true');
            };

            closeBtn.addEventListener('click', closePopup);
            
            // Đóng khi click ra ngoài
            popup.addEventListener('click', (e) => {
                if (e.target === popup) closePopup();
            });
        }

    } catch (e) {
        console.error('Notification Error:', e);
    }
});
