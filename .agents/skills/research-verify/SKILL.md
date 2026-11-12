---
name: research-verify
description: Kiểm chứng một sự thật trước khi dùng nó làm căn cứ quyết định — giấy phép, phiên bản, ngày phát hành, khả năng của API hay thư viện, giá, luật, số liệu thị trường, tính năng đối thủ. Dùng khi sắp trả lời, viết tài liệu hay khuyến nghị dựa trên thông tin như vậy. Không dùng cho câu hỏi về chính code trong repo.
---

# Kiểm chứng trước khi trả lời (AGENTS.md R1)

Không trả lời từ trí nhớ. Mỗi kết luận phải truy được về nguồn gốc, có ngày.

## 1. Tách câu khẳng định

Viết ra từng điểm cần kiểm, mỗi điểm một dòng. "NetBird tự host hỗ trợ đa tenant" là một điểm;
"từ phiên bản nào" là điểm thứ hai.

## 2. Tìm nguồn gốc theo loại thông tin

| Loại | Nguồn gốc | Chỉ là manh mối |
|---|---|---|
| Giấy phép | File `LICENSE` **ở một tag cụ thể**; với repo nhiều giấy phép thì đọc cả `LICENSES/`, `REUSE.toml` và `LICENSE` trong từng thư mục con — chúng có thể không khớp nhau (`docs/19` §1.2) | README, trang giới thiệu, bài blog |
| Phiên bản, ngày phát hành | API release của GitHub/GitLab (`published_at`), tag + commit SHA | Trang release đã qua công cụ tóm tắt |
| Khả năng API, thư viện | Tài liệu chính thức + mã nguồn ở tag đã ghim | Câu trả lời trên diễn đàn, bài tổng hợp |
| Giá | Trang giá chính thức, kèm ngày truy cập | Bài so sánh giá |
| Luật | Văn bản luật gốc, số hiệu, ngày hiệu lực | Bài phân tích luật |
| Số liệu thị trường | Báo cáo gốc, phương pháp đo, năm số liệu | Bài báo trích lại |

## 3. Ghim phiên bản

Phần mềm: **tag + commit SHA + ngày**. "Đọc từ `main` hôm nay" không phải căn cứ.
Lấy SHA của tag: `git ls-remote <url-repo> refs/tags/<tag>`.

## 4. Đối chiếu với nguồn thứ hai

Ngày tháng và con số luôn phải khớp với một nguồn thứ hai. Công cụ tóm tắt trang web có thể sai: ngày
2026-10-02, trang release v0.53.0 của NetBird bị tóm tắt là "2024", GitHub API trả về `2025-08-06`.
Nếu chỉ có một nguồn, ghi rõ điều đó.

## 5. Ghi kết quả

Mỗi kết luận một dòng, đủ bốn phần:

```
<kết luận> — nguồn: <URL hoặc file:dòng @ tag (SHA)> — truy cập <YYYY-MM-DD> — <đã kiểm chứng | chưa kiểm chứng>
```

Ghi vào tài liệu `docs/` ngay cạnh kết luận, không gom về một chỗ khác.

## 6. Khi kết quả khác với điều đang tin

- Mâu thuẫn với `docs/` → **sửa `docs/`**, và tìm mọi chỗ trỏ tới đoạn đó.
- Điều "ai cũng biết" hoá ra sai → thêm dòng vào bảng "Nhật ký giả định bị bác bỏ" của
  `docs/06-rui-ro.md` (Ngày · Giả định · Thực tế · Ảnh hưởng).
- Làm đổi một quyết định đã ghi → skill `record-decision`.

## 7. Khi không tra được

Nói thẳng **"chưa kiểm chứng"**. Không trình bày như sự thật, không dựa khuyến nghị vào nó, và ghi
thành việc phải làm (ai, kiểm gì, ở nguồn nào).
