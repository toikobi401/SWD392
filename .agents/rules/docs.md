---
trigger: glob
globs: "docs/**/*.md"
description: "Khi sửa tài liệu trong docs/: ngôn ngữ, trỏ không chép, ghi nguồn, nhật ký quyết định"
---

# Khi sửa tài liệu trong `docs/`

Bản song song cho Claude Code: `.claude/rules/docs.md` — sửa một bên thì sửa bên kia.

- Viết tiếng Việt; tên định danh, mã use case, mã tác nhân giữ tiếng Anh (`AGENTS.md` R9).
- Trỏ bằng số file và mục (`07` §3.2), không chép đoạn từ file khác hay từ repo dự án Hub (R3, `06` RW8).
- Mỗi kết luận dựa trên sự thật bên ngoài phải có nguồn + ngày truy cập; phần mềm phải ghim tag + SHA.
  Không tra được thì ghi "chưa kiểm chứng" (R1, skill `research-verify`).
- Chốt hay đảo quyết định → `09` theo skill `record-decision`. Một điều "ai cũng biết" hoá ra sai →
  thêm dòng vào "Nhật ký giả định bị bác bỏ" của `06`.
- Tài liệu kinh doanh (`12`-`18`): review khắt khe, ưu tiên bằng chứng thị trường (R8). Số liệu khảo
  sát lấy từ `18`, không mở tệp xuất gốc (R10).
- Đổi tên hay đánh lại số mục thì tìm mọi chỗ đang trỏ tới mục đó và sửa theo.
