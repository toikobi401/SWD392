---
name: done-gates
description: Chạy năm cổng "hoàn thành" của docs/08 §8 và các kiểm tra trung thực trước khi báo một thay đổi code là xong, trước khi đề xuất commit hay mở merge request. Dùng sau mọi thay đổi trong mã Go hoặc frontend.
---

# Cổng hoàn thành (docs/08 §8, AGENTS.md R6)

Chưa qua đủ cổng thì không nói "xong". Báo đúng những gì đã chạy và kết quả của nó.

## 1. Năm cổng

Chạy **đúng danh sách ở `docs/08-quy-uoc-ma-nguon.md` §8**, theo thứ tự ghi ở đó, từ gốc repo. Danh
sách ở `08` là nguồn duy nhất — nếu nó đổi, làm theo bản mới.

Lưu ý khi chạy:

- Cổng có race detector cần cgo. Máy không có trình biên dịch C (thường gặp trên Windows) thì cổng này
  **không chạy được** — báo "chưa chạy, cần CI Linux", không coi là đạt.
- Cổng frontend: chưa có frontend thì báo "không áp dụng — chưa có frontend", không tự tạo
  `package.json` để cổng chạy được.
- Lệnh định dạng phải **không in ra gì**. Có file in ra thì cổng trượt.

## 2. Kiểm tra trung thực

- Không có phần triển khai giả: `panic("not implemented")`, `TODO` thay cho logic, dữ liệu giả trả về
  từ API, màn hình mock (`08` §9). Tìm bằng `grep` trong phần vừa sửa.
- Luật phụ thuộc một chiều (`08` §1): `internal/core` không import hạ tầng. Cách kiểm tự động **đã
  chốt 2026-10-24** (`09` QĐ-37): một test Go đọc `go list -deps`, dự kiến `internal/arch_test.go`.
  **Test đó chưa viết** — trong lúc chờ, xem `go list -deps ./internal/core/...` và báo nếu thấy
  package `internal/` khác, driver CSDL, `net/http` hay `golang.org/x/sys/windows`.
- Code trong `internal/agent` có test bằng dữ liệu thật từ agent thật (`08` §8, `06` RW2).
- Có dependency mới trong `go.mod` mà chưa qua skill `add-dependency` → dừng và báo.

## 3. Báo cáo

```
Cổng                 Kết quả       Ghi chú
<cổng 1 theo 08 §8>  đạt / trượt / chưa chạy (lý do)
...
Kiểm tra trung thực: ...
```

Trượt thì dán phần output lỗi liên quan. Không commit, không push khi chưa được yêu cầu (R7).
