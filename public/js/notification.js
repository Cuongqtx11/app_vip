document.addEventListener("DOMContentLoaded", function() {
    // Chỉ cần tải file popup.html duy nhất
    fetch('/components/popup.html')
        .then(response => {
            if (!response.ok) throw new Error("Không tìm thấy popup");
            return response.text();
        })
        .then(htmlContent => {
            // 1. Chèn HTML vào cuối trang
            document.body.insertAdjacentHTML('beforeend', htmlContent);

            // 2. Kích hoạt thẻ <script> bên trong popup
            // (Mặc định insertAdjacentHTML không chạy script để bảo mật, ta phải chạy thủ công)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            const scripts = tempDiv.querySelectorAll('script');
            
            scripts.forEach(oldScript => {
                const newScript = document.createElement('script');
                newScript.textContent = oldScript.textContent;
                document.body.appendChild(newScript);
            });
        })
        .catch(err => console.log('Popup info:', err));
});
