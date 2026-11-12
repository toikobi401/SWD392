---
name: add-dependency
description: Thẩm định trước khi thêm một dependency — module Go, gói npm, công cụ, binary bên thứ ba, hoặc nhúng mã của dự án khác. Dùng trước khi sửa go.mod hay package.json, trước khi vendor hay sao mã vào repo, và khi người dùng hỏi "dùng thư viện X được không".
---

# Thêm dependency (AGENTS.md R5, docs/08 §9)

**Không thêm dependency mà không hỏi.** Skill này tạo ra một bản đề xuất; người dùng duyệt rồi mới
`go get` / `npm install`.

## 1. Có cần không

- Thư viện chuẩn Go có làm được không? (`08` §2: `http.ServeMux` đủ cho routing — router ngoài cần lý
  do cụ thể.)
- Nó thay cho cái gì? Nếu `docs/` đang ghi **[CHƯA CHỐT]** cho chỗ này thì đây là một quyết định, không
  phải một dependency — đi qua skill `record-decision`.

## 2. Giấy phép — kiểm ở tag đã ghim

Theo skill `research-verify`: đọc `LICENSE` ở đúng tag định dùng, cả `LICENSES/`, `REUSE.toml` và
`LICENSE` trong thư mục con nếu có. Kiểm cả **dependency bắc cầu** mà nó kéo vào (`go list -m all`
trước và sau).

Dừng ngay và báo người dùng nếu gặp:

- **AGPL** ở bất kỳ đâu trong cây sẽ biên dịch vào binary — cấm (R5). Với NetBird: không import gì từ
  các thư mục AGPL ở `docs/19` §1.2; chỉ `client/`, `shared/`, `encryption/` (BSD-3) được nhúng, và
  phải kiểm lại mỗi lần nâng phiên bản (`19` §3.3).
- Mã từ repo `homelab-control-plane` (dự án Hub) — không chép, không submodule (`06` RW8).
- GPL, SSPL, BSL, giấy phép "source-available" hay giấy phép tự chế — `docs/` chưa có chính sách cho các
  loại này; không tự kết luận, nêu rõ và đề xuất ghi chính sách vào `09`.

## 3. Kích thước và bảo trì

Ghi số đo, kèm ngày:

- Số dependency bắc cầu mới; mức tăng kích thước binary (`go build` trước/sau) nếu đo được.
- Phát hành gần nhất (ngày, từ API release), tần suất commit, số người bảo trì, issue bảo mật mở.
- Có cần cgo không — ảnh hưởng tới build chéo cho agent và CI.

## 4. Đề xuất cho người dùng

```
Dependency: <module>@<tag> (<SHA>)
Làm gì / thay cho: ...
Giấy phép: <loại> — nguồn: <URL LICENSE @ tag>, truy cập <ngày>; bắc cầu: ...
Kích thước: ...    Bảo trì: ...
Phương án không dùng nó: ...
```

Người dùng duyệt → thêm dependency. Nếu đây là lựa chọn kiến trúc (thư viện dữ liệu, sinh kiểu API,
cơ chế CSRF…) → ghi vào `09` bằng skill `record-decision`.
