---
name: drawio-diagram
description: Dựng, sửa hoặc rà một sơ đồ `.drawio` trong `docs/` — và script sinh ra nó. Bắt buộc dùng trước khi thêm một sơ đồ mới, khi sửa script `scripts/gen-*-diagram.js`, khi một quyết định làm sơ đồ cũ sai, và trước khi báo một thay đổi sơ đồ là xong. Phủ: convention theo loại sơ đồ, ngôn từ trên nhãn, luật không overlap, đọc được, một nguồn sự thật, và bảy cổng hoàn thành.
---

# Sơ đồ drawio trong `docs/`

Một sơ đồ sai không im lặng như một đoạn văn sai: người đọc **suy ra quan hệ không có thật** rồi
thiết kế theo. Vì vậy sơ đồ có cổng, giống code.

Nguồn quy tắc liên quan: `AGENTS.md` R3 (một nguồn sự thật), R9 (ngôn ngữ), R13 (tài liệu phải nằm
trong bản đồ), `docs/21-quy-trinh-ui-ux.md` §4 (trợ năng), `docs/08-quy-uoc-ma-nguon.md` §8 (ý tưởng
"chưa qua cổng thì không nói xong").

---

## 0. Luật số 0 — file `.drawio` là sản phẩm SINH RA, không phải file nguồn

| Luật | Vì sao |
|---|---|
| Mỗi `.drawio` trong `docs/` phải có một script sinh ở `scripts/gen-<tên>-diagram.js` | Sơ đồ vẽ tay sẽ lệch khỏi tài liệu ngay lần sửa thứ hai, và không ai biết nó đã lệch |
| **Không sửa XML tay.** Sửa đặc tả trong `docs/` → sửa script → chạy lại script | XML sửa tay bị ghi đè ở lần chạy sau. Công mất, và mất im lặng |
| Script **fail-closed**: tự kiểm không đạt thì **không ghi file**, `throw` kèm danh sách lỗi | Một sơ đồ hỏng đã ghi ra đĩa sẽ được commit. Một script `throw` thì không |
| Sơ đồ nào không có script sinh thì **nói ra**, đừng im lặng vẽ tay | Nợ phải thấy được |

**Hiện có trong repo:**

| Sơ đồ | Script | Tài liệu đặc tả |
|---|---|---|
| `docs/11-usecase.drawio` (4 tab) | `scripts/gen-usecase-diagram.js` | `docs/11-usecase.md` |
| `docs/36-erd.drawio` (11 tab) | `scripts/gen-erd-diagram.js` | `docs/36-erd.md` |

---

## 1. Đúng convention của chính loại sơ đồ đó

Chọn sai ký hiệu là **lỗi biểu đạt**, không phải lỗi thẩm mỹ.

| Loại | Ký hiệu bắt buộc | Cấm |
|---|---|---|
| **Use case (UML)** | Tác nhân = stick figure ngoài biên; use case = ellipse; biên hệ thống = hộp bao; quan hệ chỉ dùng `«include»`, `«extend»`, `«precedes»`, generalization | Cạnh tác nhân–UC **không có mũi tên** (nó là association, không phải luồng). Không vẽ luồng dữ liệu, không vẽ thứ tự thời gian, không vẽ bước bên trong một UC |
| **ERD (crow's foot)** | Thực thể = hộp có header + danh sách cột; khoá ngoại = cạnh crow's foot (`ERone` → `ERoneToMany`); khoá ngoại NULL-able = **nét đứt** + `ERzeroToOne` | Không dùng mũi tên thường cho khoá ngoại. Không vẽ hành vi/thao tác. Không vẽ bảng dẫn xuất như bảng thật mà không ghi rõ |
| **Sequence** | Trục thời gian **dọc**, lifeline, thông điệp có nhãn, `Note over` cho ràng buộc | Không vẽ cấu trúc tĩnh. Không đảo trục |
| **Deployment / topology** | Node = hộp lồng nhau; cạnh = kênh mạng có nhãn **giao thức + cổng**; ranh giới tin cậy vẽ tường minh | Không trộn tiến trình với máy mà không phân cấp hộp |

**Hai luật chung cho mọi loại:**

- **Một tab = một mức trừu tượng.** Trộn "hệ thống nói với hệ thống" và "hàm gọi hàm" trong một tab
  là cách chắc chắn làm sơ đồ vô dụng.
- **Cạnh xuyên cụm/xuyên phân hệ: KHÔNG vẽ, ghi bằng chữ** trong một note "OFF-PAGE LINK". Đây là
  thứ đã làm `11-usecase.drawio` từ không đọc được thành đọc được.

---

## 2. Ngôn từ trên nhãn

**Chốt 2026-10-24: nhãn trong `.drawio` viết tiếng Anh toàn bộ** — tiêu đề, phụ đề, note, legend,
nhãn cạnh. Giải thích tiếng Việt nằm ở **file `docs/` sở hữu sơ đồ**, không nằm trên hình.

| Luật | Kiểm thế nào |
|---|---|
| **Không có chữ có dấu trong nhãn** | Gate tự động: fail nếu nhãn khớp `/[À-ỹ]/` |
| **Không có tiếng Việt mất dấu** (`khong`, `nguoi dung`, `trang thai`) | Review — nó không phải tiếng Anh, cũng không phải tiếng Việt đúng. Đây là lỗi hay gặp nhất khi người viết tránh vấn đề encoding |
| Mã UC, mã tác nhân, tên bảng, tên cột **giữ nguyên như trong `docs/`** | Không dịch, không viết tắt lại. Lệch một ký tự là một thực thể khác |
| **Mọi ký hiệu đã dùng phải có trong legend** | Đọc legend rồi soi lại từng tab |
| Chỗ chưa chốt phải **hiện trên sơ đồ**: `[NOT DECIDED #n]` trỏ câu treo của `09` | Im lặng bỏ qua chỗ chưa chốt là trình bày phỏng đoán như sự thật |

> Comment **trong script** vẫn viết tiếng Việt — nó là code, không phải nhãn (R9).

---

## 3. Hình học: bốn phép kiểm không overlap

Script phải tự kiểm **cả bốn**, và `throw` nếu sai:

| # | Phép kiểm | Ngưỡng |
|---|---|---|
| 1 | **shape × shape** — hai hình không chồng nhau | Chồng > 0 px là fail |
| 2 | **cạnh × shape** — cạnh không đi xuyên hình nào, trừ hai đầu của chính nó | Giao > 0,5 px là fail |
| 3 | **cạnh × cạnh** — hai cạnh **khác chủ** không trùng tuyến (cùng `x` hoặc cùng `y`) | Chồng > 2 px là fail. Cùng chủ thì là nhánh của một chùm, chấp nhận |
| 4 | **tràn trang** — mọi hình nằm trong `[0, pageWidth] × [0, pageHeight]` | Vượt 1 px là fail |

**Định tuyến tường minh là BẮT BUỘC.** Phép 2 và 3 chỉ chạy được khi script tự đặt waypoint. Để
drawio tự định tuyến (`edgeStyle=orthogonalEdgeStyle` không waypoint) là **tự tắt hai phép kiểm**, và
kết quả đã thấy: cạnh đâm xuyên hộp, cạnh chồng cạnh, nhãn rơi lên hình.

> **Bản đầu của skill này có một ngoại lệ** — "để drawio tự đi cũng được, miễn ghi rõ trong header và
> mở xem mắt thường". **Ngoại lệ đó đã bị bỏ ngày 2026-10-24** sau khi chính nó tạo ra một sơ đồ
> không đọc được. Bài học, áp cho mọi cổng chứ không riêng sơ đồ: **một phép kiểm không chạy được
> không phải một phép kiểm**, và "sẽ xem bằng mắt" không thay được nó.

**Không định tuyến nổi một cạnh thì KHÔNG vẽ cạnh đó** — ghi quan hệ bằng chữ trong hộp (cột `FK`)
và một dòng trong legend. Bỏ cạnh là mất một chút thông tin; vẽ bừa là mất cả sơ đồ.

**Tránh tốt hơn sửa** — ba cách đã có tác dụng trong repo này:

- **Một làn dọc riêng cho mỗi chủ cạnh**, nằm ngoài hộp bao (cách của `gen-usecase-diagram.js`).
- **Tách tab theo cụm**, và cắt hết cạnh xuyên cụm.
- **Bố cục phân tầng**: hộp cha (đích của khoá ngoại) luôn nằm **trên** hộp con, và giữa hai tầng
  là một **dải định tuyến rỗng**; mỗi cạnh một **track** riêng trong dải, cấp bằng thuật toán phủ
  khoảng. Cạnh vượt hơn một tầng đi qua **hành lang dọc riêng** ở mép phải, ngoài vùng hộp.
- **Mỗi điểm bám một `x` riêng.** Hai cạnh cùng rời một hộp ở cùng toạ độ sẽ tạo hai đoạn dọc chồng
  nhau — phép 3 bắt được, nhưng rẻ hơn là tách ngay từ lúc đặt điểm bám.
- **Gom bảng không có cạnh nào trong tab thành một lưới riêng ở dưới.** Xếp chúng cùng hàng với
  phần có cạnh chỉ kéo trang rộng ra vô ích: một tab từng ra 2866×576, sau khi gom còn 1636×896.

---

## 4. Đọc được

| Hạng mục | Ngưỡng |
|---|---|
| Cỡ chữ | ≥ 9 px cho nhãn và cột, ≥ 11 px cho header hộp |
| Khoảng cách giữa hai hình | ≥ 40 px |
| Lề trang | ≥ 40 px mọi phía |
| Số hình chính một tab | **Trần 8.** Quá thì **tách tab**, đừng thu nhỏ chữ và đừng nhồi. Tab chia
nhỏ hơn cụm trong tài liệu là chuyện bình thường — router cần chỗ để đi |
| Tỉ lệ trang | Không để trang dài ngoằng một chiều. Nếu rộng gấp hơn ~3 lần chiều cao thì xếp lại, đừng để người đọc rà ngang |
| Màu | Dùng đúng bộ màu đang có trong hai script. **Không mã hoá thông tin CHỈ bằng màu** (`21` §4) — phải có nhãn hoặc hình kèm; tương phản phần không phải chữ ≥ 3:1 |

---

## 5. Một nguồn sự thật (R3)

Script **không được** trở thành bản sự thật thứ hai:

- Mọi tên/mã trong script phải xuất hiện trong file `docs/` đặc tả, và **script phải tự kiểm điều
  đó**. Ví dụ đang chạy: `gen-erd-diagram.js` đọc `docs/36-erd.md` và fail nếu có tên bảng không
  xuất hiện ở đó.
- **Khẳng định số lượng** trong script: `if (total !== 37) fail.push(...)`. Lệch là fail, không phải
  cảnh báo.
- Theo **R13**: sơ đồ phải có hàng trong bản đồ `docs/` ở `AGENTS.md` §2. Hàng đó thuộc **tài liệu
  sở hữu** sơ đồ; **script không có hàng riêng** — ghi tên script ngay trong hàng của tài liệu, để
  ai sửa tài liệu biết phải chạy lại script.

---

## 6. Determinism

Cùng input phải cho output **byte-identical**: id sinh bằng bộ đếm, **không random, không timestamp,
không thứ tự phụ thuộc duyệt hash**. Nếu không, mọi lần chạy lại tạo một diff rác và không ai review
được sơ đồ nữa.

---

## 7. Tám cổng trước khi báo xong

Chạy đủ tám. Chưa đủ thì **không nói "xong"**.

1. **Chạy script**: `node scripts/gen-<tên>-diagram.js docs/<tên>.drawio` — tự kiểm đạt và file được
   ghi.
2. **Dán nguyên văn output** của script vào câu trả lời: số tab, số hình, số cạnh, kích thước trang.
   Không diễn giải lại, không rút gọn.
3. **Mở file trong drawio, xem từng tab.** Bắt buộc nếu script không kiểm được phép 2 và 3 của §3.
4. **Kiểm nhãn** theo §2: không chữ có dấu, không tiếng Việt mất dấu, mã giữ nguyên như `docs/`.
5. **Kiểm legend** có đủ mọi ký hiệu đã dùng trên mọi tab.
6. **Kiểm hàng của tài liệu sở hữu** trong `AGENTS.md` §2 còn đúng: số tab, tên script.
7. **Thử âm ít nhất một gate**: cố tình tiêm một vi phạm (ví dụ một nhãn có dấu) vào bản copy của
   script và xác nhận nó `throw` **và không ghi file**. Một gate chưa bao giờ nổ thì chưa chứng
   minh được gì.
8. Nếu sơ đồ đổi vì **một quyết định**: ghi `09` theo skill `record-decision`. Nếu đổi vì một giả
   định cũ sai: thêm dòng vào "Nhật ký giả định bị bác bỏ" của `06`.

**Báo trung thực:** nếu bước 3 bị bỏ, nói rõ là bỏ và vì sao. Nếu một phép kiểm không áp dụng được,
nói nó không áp dụng được — đừng gọi nó là đạt.
