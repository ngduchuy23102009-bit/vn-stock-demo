# VN Stock Demo 📈

Web demo thị trường chứng khoán Việt Nam — HTML/CSS/JS thuần, không cần cài đặt gì.

## Chạy

Cách 1 (khuyến nghị, có server tĩnh): mở PowerShell trong thư mục này:

```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

rồi mở trình duyệt tại `http://127.0.0.1:8437/`.

Cách 2: nhấp đúp `index.html` (mọi trình duyệt hiện đại đều chạy được vì API cho phép CORS).

## Tính năng

- **Bảng giá** 3 sàn HOSE / HNX / UPCOM — dữ liệu thật, màu xanh–đỏ–tím theo quy ước VN, tự refresh 30 giây, có hiệu ứng nhấp nháy khi giá đổi.
- **Thống kê phiên**: số mã tăng/giảm/đứng giá, tổng KL và GT khớp lệnh.
- **Chi tiết cổ phiếu**: biểu đồ nến 1M/3M/6M/1 năm + MA20 + cột khối lượng (vẽ tay bằng canvas, không dùng thư viện), thông số trần/sàn/tham chiếu/OHLC.
- **Watchlist**: thêm/bớt mã bằng ngôi sao, lưu localStorage.
- **Danh mục giả lập (paper trading)**: 500 triệu ₫ tiền ảo; chỉ được đặt lệnh **trong phiên giao dịch** (T2–T6, 9:00–15:00 giờ VN); lệnh vào **sổ chờ khớp** và được đối chiếu với sổ cung–cầu giả lập (best bid/ask quanh giá thị trường) mỗi lần cập nhật dữ liệu — khớp toàn bộ hoặc một phần, mua đúng giá thị trường khớp tại đó, có thể **hủy lệnh**; cổ phiếu/tiền được tạm giữ đến khi khớp hoặc hủy.

## Nguồn dữ liệu & giới hạn

- API công khai VNDirect: `https://api-finfo.vndirect.com.vn/v4/stock_prices` (không chính thức, có thể thay đổi bất cứ lúc nào).
- API hiện chỉ nhận truy vấn **theo từng ngày chính xác**, nên lịch sử nến được gom từ nhiều request theo ngày và cache trong `localStorage` (`vd_hist:<MÃ>`). Lần đầu xem nến 1 năm sẽ hơi chậm, các lần sau lấy từ cache.
- Chỉ số VN-Index không có trong API này → thay bằng thống kê phiên tính từ dữ liệu sàn.
- Giá hiển thị theo **nghìn đồng** (58,40 = 58.400₫) đúng quy ước bảng giá VN; danh mục quy đổi ×1000 khi tính tiền.
- Đây là demo phi thương mại, không phải khuyến nghị đầu tư.
