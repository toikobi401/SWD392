---
paths:
  - "**/*.go"
  - "go.mod"
  - "go.sum"
---

# Khi sửa code Go

Bản song song cho Antigravity: `.agents/rules/go-code.md` — sửa một bên thì sửa bên kia.

Đọc `docs/08-quy-uoc-ma-nguon.md` trước khi viết. Trỏ nhanh:

- Bố cục package, luật phụ thuộc một chiều (`core` không import hạ tầng): `08` §1.
- Endpoint, kiểu payload, handler có tên: `08` §2. Lỗi nghiệp vụ `*core.Error`, Problem Details: `08` §3.
- Xác thực, phiên, CSRF: `08` §4. Tiến trình con: `07` §2.2. Cấu hình, bind mạng: `08` §7.
- Chỗ ghi **[CHƯA CHỐT]** trong `08` hoặc `03`: dừng lại hỏi, không chọn ngầm (`AGENTS.md` R6).
- Thêm module vào `go.mod`: skill `add-dependency` trước (R5). Không import thư mục AGPL của NetBird
  (`19` §1.2). Không chép code dự án Hub (`06` RW8).
- Trước khi báo xong: skill `done-gates` (`08` §8).
