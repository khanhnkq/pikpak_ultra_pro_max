# PikPak Streamer Ultra Pro Max (Chrome Extension)

Chrome Extension (Manifest V3) hỗ trợ xem video không giới hạn từ link chia sẻ công khai PikPak (`mypikpak.com/s/...`) **mà không cần đăng nhập tài khoản PikPak** và **không cần lưu video về tài khoản**.

---

## Tính năng nổi bật

- 🔓 **Phát Full không ngắt quãng**: Vượt qua rào cản xem trước 30 giây (preview 00:30) trên giao diện web PikPak.
- 🚀 **Guest Mode API**: Tự động sinh `captcha_sign` theo thuật toán bảo mật của PikPak để lấy danh sách file và stream link gốc mà không yêu cầu tài khoản.
- 🎬 **Tách rời React Player**: Tự động ngắt kết nối trình phát preview của PikPak và thay thế bằng HTML5 Video Player độc lập, hỗ trợ tua (seek) mượt mà với `Content-Range`.
- 🌐 **Tầng mạng thông minh (`declarativeNetRequest`)**:
  - Gỡ bỏ header `Content-Disposition: attachment` để phát luồng trực tiếp thay vì tự động mở hộp thoại download.
  - Thiết lập `Content-Type: video/mp4` và cấu hình CORS đầy đủ (`Access-Control-Allow-Origin: *`).
- 📁 **Hỗ trợ thư mục & nhiều video**: Tự động liệt kê và cho phép lựa chọn giữa các video trong cùng một liên kết chia sẻ.
- 💾 **Tải về trực tiếp**: Nút download file gốc chất lượng cao với 1 click.
- 🔒 **Hỗ trợ link có mật khẩu**: Tự động phát hiện và cho phép nhập mã truy cập nếu link chia sẻ được đặt pass.

---

## Cấu trúc dự án

```text
pikpak_ultra_pro_max/
├── manifest.json            # Cấu hình Manifest V3
├── rules.json               # Cấu hình declarativeNetRequest (CORS & streaming headers)
├── service-worker.js        # Background Service Worker quản lý API & cache
├── lib/
│   ├── constants.js         # Endpoint và khóa thuật toán PikPak Web
│   ├── md5.js               # Hàm băm MD5 xử lý chuỗi UTF-8
│   └── pikpak-api.js        # Client gọi API PikPak chế độ Guest
├── content/
│   ├── injector.js          # Content Script (ISOLATED) làm cầu nối
│   └── main.js              # Script nhúng (MAIN) hook fetch/XHR và DOM
├── player/
│   ├── player.js            # Điều khiển trình phát video độc lập
│   └── player.css           # Giao diện Glassmorphic hiện đại
├── popup/
│   ├── popup.html           # Giao diện popup extension
│   ├── popup.css            # Styles giao diện dark mode
│   └── popup.js             # Logic popup & trích xuất link thủ công
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

---

## Hướng dẫn cài đặt vào trình duyệt (Chrome / Edge / Brave / Cốc Cốc)

1. Mở trình duyệt và truy cập trang quản lý extension:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
   - **Cốc Cốc**: `coccoc://extensions`
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Bấm vào nút **Tải tiện ích đã giải nén (Load unpacked)**.
4. Chọn thư mục:
   ```text
   /Users/nguyenkimquockhanh/Desktop/pikpak_ultra_pro_max
   ```
5. Tiện ích **PikPak Streamer Ultra Pro Max** sẽ xuất hiện trên thanh công cụ của trình duyệt. Ghim (pin) extension lên thanh công cụ để tiện thao tác.

---

## Cách sử dụng

### Cách 1: Xem trực tiếp trên trang PikPak (Khuyên dùng)
1. Mở bất kỳ link chia sẻ PikPak nào (ví dụ: `https://mypikpak.com/s/xxxxxx`).
2. Ở góc trên bên phải màn hình sẽ xuất hiện thanh điều khiển màu tối: **PikPak Streamer**.
3. Bấm vào nút **🔓 Stream Full**:
   - Extension sẽ tự động phân tích và lấy link video chất lượng cao nhất.
   - Trình phát 30 giây mặc định sẽ được thay thế bằng trình phát Full.
   - Các pop-up/overlay đếm ngược 30s sẽ tự động bị ẩn.
4. Nếu link chia sẻ có nhiều video, bạn có thể chọn video từ dropdown trên thanh công cụ.

### Cách 2: Trích xuất qua Popup Extension
1. Bấm vào biểu tượng extension trên thanh công cụ.
2. Dán link chia sẻ PikPak vào ô nhập (hoặc bấm biểu tượng Dán).
3. Bấm **Trích xuất luồng Video**.
4. Danh sách các video sẽ hiển thị:
   - Bấm **▶ Phát** để mở luồng video trực tiếp trên tab mới.
   - Bấm **💾** để tải file video về máy tính.
   - Bấm **🔗** để sao chép đường dẫn stream trực tiếp.
