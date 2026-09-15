# vndirect-chart-next

Đây là một App biểu đồ giá chứng khoán được xây dựng bằng Next.js và
TypeScript. Dự án sử dụng dữ liệu được Reverse-Engineered từ hệ thống VNDirect để hiển thị biểu đồ
nến, khối lượng giao dịch và dữ liệu giá theo thời gian thực.

Biểu đồ được chạy hoàn toàn ở phía trình duyệt. Thành phần chính là
`components/Chart.tsx`, được đánh dấu là một Client Component của Next.js.
Cách triển khai này phù hợp với các thư viện biểu đồ và kết nối WebSocket vì
chúng cần môi trường trình duyệt để hoạt động.

## Cài đặt và chạy dự án

Yêu cầu máy tính đã cài Node.js và npm

```bash
npm install
npm run dev
```

Sau khi chạy lệnh, mở địa chỉ được hiển thị trong terminal, thường là
`http://localhost:3000`

## Chức năng chính

- Hiển thị biểu đồ nến cho VN30 và VNINDEX
- Hỗ trợ các khung thời gian 1 phút, 5 phút, 15 phút, 1 giờ và 1 ngày
- Cập nhật giá theo thời gian thực thông qua WebSocket
- Hiển thị khối lượng giao dịch
- Hỗ trợ một số công cụ vẽ và chỉ báo kỹ thuật
- Lưu và khôi phục các đối tượng vẽ trên biểu đồ

## Cấu trúc dự án

- `app/page.tsx`: Trang chính của ứng dụng
- `app/layout.tsx`: Bố cục chung của ứng dụng
- `app/globals.css`: Các quy tắc giao diện dùng chung
- `components/Chart.tsx`: Biểu đồ sử dụng Lightweight Charts
- `lib/dchart-api.ts`: Gọi API để lấy dữ liệu lịch sử
- `lib/dchart-socket.ts`: Kết nối WebSocket để nhận giá trực tiếp
- `lib/bar-builder.ts`: Gom các tick giá thành dữ liệu nến OHLCV
- `python_scripts/vndirect_history_puller.py`: Tải dữ liệu lịch sử về file CSV
- `python_scripts/vndirect_realtime_tail.py`: Nhận dữ liệu trực tiếp và ghi thành nến

## Luồng hoạt động

Khi người dùng chọn một mã chứng khoán và khung thời gian, ứng dụng sẽ gọi API
để lấy dữ liệu lịch sử ban đầu. Sau đó, ứng dụng mở kết nối WebSocket để nhận
các thay đổi giá mới.

Các tick giá được xử lý bởi `bar-builder.ts`. Những tick thuộc cùng một khoảng
thời gian sẽ được gộp thành một nến. Khi xuất hiện khoảng thời gian mới, ứng
dụng tạo một nến mới và tiếp tục cập nhật nến này khi có dữ liệu.

## Tải dữ liệu bằng Python

Có thể dùng script lịch sử để tải dữ liệu về thư mục `data`

```bash
python python_scripts/vndirect_history_puller.py --symbols VN30 VNINDEX VNM --resolutions D 1
```

Để tải danh sách nhiều mã cổ phiếu, dùng thêm tùy chọn `--all-stocks`

```bash
python python_scripts/vndirect_history_puller.py --all-stocks --resolutions D --outdir ./data
```

Script dữ liệu trực tiếp có thể được chạy như sau

```bash
python python_scripts/vndirect_realtime_tail.py --symbol VN30 --resolution 1 --outdir ./live
```

## Một số lưu ý

- `socket.io-client` đang giữ ở phiên bản `^2.5.0` vì máy chủ sử dụng Engine.IO v3
- Không nên tự ý nâng phiên bản thư viện WebSocket nếu chưa kiểm tra lại giao thức máy chủ
- Khoảng thời gian dữ liệu ban đầu trong `rangeForResolution` chỉ nhằm tạo khung nhìn cho biểu đồ
- Dữ liệu được lấy trực tiếp từ hạ tầng riêng của VNDirect và có thể thay đổi theo thời gian
- Các API được sử dụng trong dự án không được mô tả đầy đủ trong tài liệu công khai

## Hướng phát triển

Dự án hiện tập trung vào việc hiển thị và xử lý dữ liệu biểu đồ ở phía trình
duyệt. Trong tương lai, có thể nhúng vào dự án "VNDIRECT AI Autonomous Trading Platform"
