---
name: record-decision
description: Ghi một quyết định kiến trúc, kỹ thuật hay phạm vi vào docs/09-nhat-ky-quyet-dinh.md theo mẫu Quyết định · Lý do · Cái giá; ghi đính chính khi đảo quyết định; thêm hoặc đóng câu hỏi trong bảng "Quyết định còn treo". Dùng khi người dùng vừa chốt một lựa chọn, khi đưa hạng mục từ ngoài vào trong phạm vi, hoặc khi gặp chỗ [CHƯA CHỐT].
---

# Ghi quyết định (AGENTS.md R4)

**Agent không tự chốt quyết định.** Agent đề xuất và nêu đánh đổi; người dùng chốt; sau đó mới ghi.

## 1. Quyết định mới

Thêm một mục theo mẫu ở cuối `docs/09-nhat-ky-quyet-dinh.md` (mục "Mẫu cho lần ghi sau"), đặt trước
bảng "Quyết định còn treo", theo thứ tự ngày.

Kiểm từng cột trước khi ghi:

- **Quyết định** — một câu, chốt cái gì. In đậm phần cốt lõi.
- **Lý do** — vì sao, đủ để sáu tháng sau không ai hỏi lại. Lý do dựa trên sự thật bên ngoài (giấy
  phép, giá, khả năng thư viện) thì phải qua skill `research-verify` và ghi nguồn + ngày.
- **Cái giá** — đánh đổi gì. **Không được để trống hay ghi "Không có".** Không nghĩ ra cái giá nghĩa
  là chưa cân nhắc đủ: dừng lại và hỏi người dùng.

## 2. Đảo hoặc đính chính quyết định cũ

Không xoá hay sửa lặng lẽ dòng cũ. Thêm mục mới (ví dụ "Đính chính …", "Đổi …"), nói rõ dòng nào bị
thay và vì sao. Nếu lý do là một giả định sai → thêm dòng vào "Nhật ký giả định bị bác bỏ" của
`docs/06-rui-ro.md`.

## 3. Đưa hạng mục từ ngoài vào trong phạm vi

Theo `docs/04-pham-vi.md` §5: một mục mới trong `09` có ngày, lý do, cái giá. Không sửa lặng lẽ bảng
"Ngoài phạm vi" của `04` §2 — sửa `04` sau khi đã có mục trong `09`, và trỏ ngược về mục đó.

## 4. Câu hỏi chưa chốt

- **Thêm:** một hàng vào bảng "Quyết định còn treo" — số thứ tự kế tiếp, câu hỏi, **chốt trước khi**
  (một mốc cụ thể trong lộ trình, không phải "sau này"), và tài liệu nơi câu hỏi được bàn.
- **Đóng:** ghi quyết định theo §1, sửa hàng đó để trỏ tới mục vừa ghi, và gỡ dấu **[CHƯA CHỐT]** ở
  tài liệu liên quan (thường là `03`, `08`, `19`).

## 5. Sau khi ghi

Tìm mọi tài liệu đang mô tả trạng thái cũ (`grep` theo từ khoá của quyết định) và sửa theo, hoặc trỏ
tới `09`. Không chép nội dung quyết định sang file khác (R3).
