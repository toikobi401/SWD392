---
trigger: glob
globs: "internal/agent/**"
description: "Khi sửa package internal/agent: giao thức MeshCentral, xử lý byte, test bằng dữ liệu thật"
---

# Khi sửa package `internal/agent` (giao thức MeshCentral)

Bản song song cho Claude Code: `.claude/rules/agent-protocol.md` — sửa một bên thì sửa bên kia.

Đây là phần khoá cứng vào agent biên dịch sẵn của MeshCentral — sai một byte là agent thật không kết
nối được. Đọc trước khi viết:

- Hợp đồng cố định, không được đổi: `docs/00-tong-quan.md` §2, §4.
- Giao thức agent: `docs/01-giao-thuc-agent.md`. Relay và kênh: `docs/02-relay-va-kenh.md`.
- `[]byte` xuyên suốt, không `string`, không `range` theo rune; latin-1 → UTF-8 đúng cách: `08` §6.
- Test từng byte bằng **dữ liệu thật từ agent thật**, dựng khối core bằng cây module thật — fixture
  ASCII tự chế cho test xanh với code sai: `08` §8, `06` RW2.
- Đọc mã Node của MeshCentral để hiểu giao thức thì được (Apache-2.0); khi trích hành vi, ghi
  file:dòng và tag/commit đã đọc (`AGENTS.md` R1).
