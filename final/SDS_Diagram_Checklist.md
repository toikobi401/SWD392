# SDS mới — Phân công 40 diagram & Checklist

> Dự án: **HotelHub Management System** · Nguồn: `System Design and Overall Architecture/System Design and Overall Architecture.md` và code trong `System Design and Overall Architecture/src/`
> Mẫu SDS tham khảo: `final/Requirement & Design Specification sample.docx`

## Thành viên

| Mã | Thành viên | Mảng phụ trách (subsystem) |
|---|---|---|
| M1 | **Lê Trần Trọng Đạt** | Inventory & Pricing |
| M2 | ____________________ | Auth & Administration |
| M3 | Lê Đức Anh | Booking & Customer |
| M4 | ____________________ | Billing & Payment |
| M5 | ____________________ | Front Desk & HR |

Mỗi người: **4 use case**, mỗi use case vẽ **1 class diagram (CD) + 1 sequence diagram (SD)** → 4 CD + 4 SD/người, tổng 40.

---

## 1. Quy ước chung (cả nhóm làm theo)

- [ ] **CD-xx và SD-xx cùng số là cùng một use case**, dùng chung bộ class.
  - Mỗi lifeline trong SD (trừ Actor và DB) phải là một class trong CD.
  - Mỗi bước gọi vào một lifeline ứng với một method của class đó trong CD (khớp về ý nghĩa và thứ tự; nhãn SD viết bằng ngôn ngữ nghiệp vụ nên không trùng chữ với tên method).
- [ ] **Sequence diagram**: 5 lifeline `Actor – UI page – Controller – Model – DB`, theo mẫu `SD-01`.
  - Chỉ thêm lifeline hệ thống ngoài (payOS, Email service) khi nó nằm trên luồng chính.
  - UC chạm 2 model thì vẽ cả 2 model (VD `User, Role`).
  - **1 luồng chính + 1 luồng thay thế**: đúng 1 khung `alt` 2 nhánh — nhánh trên là luồng thành công, nhánh dưới là lỗi nghiệp vụ chính của UC. Không dùng `opt`/`loop`/`ref`, không lồng khung.
  - Nhãn message bằng ngôn ngữ nghiệp vụ tiếng Anh, ngắn (VD `get pending refund requests`), không ghi query, field hay danh sách mã lỗi. Message trả về dùng nét đứt.
  - Controller chỉ có 1 self-call `validate request` (gộp xác thực, phân quyền, kiểm tra dữ liệu); xác thực coi là tiền điều kiện, không vẽ nhánh 401/403.
- [ ] **Class diagram** (design class diagram cho một UC):
  - Class: UI page `<<boundary>>` · Controller `<<boundary>>` · Model `<<entity>>` · enum `<<enumeration>>` mà model dùng — chỉ các class có mặt trong SD cùng số.
  - Model: ghi thuộc tính lấy từ `src/server/src/models/*.model.ts` (đúng tên, kiểu).
  - Method: chỉ các method ứng với bước còn lại trong SD (Controller: handler + `validateRequest`).
  - Quan hệ: Page ⇢ Controller (dependency, gọi API) · Controller ⇢ Model (dependency) · giữa các Model dùng association có multiplicity.
  - Không vẽ lại toàn bộ subsystem — 9 class diagram subsystem đã có trong `diagrams/class_diagrams/`.
- [ ] **Định dạng**: mỗi diagram có 2 file cùng tên:
  - `.drawio` — shape gốc, sửa trực tiếp trong draw.io, trình bày theo mẫu `diagrams/sequence_diagrams/UC-M09_Update_Room_Info_SequenceDiagram.drawio`. Ảnh chèn SDS xuất từ draw.io (File → Export as → PNG).
  - `.txt` — mã PlantUML (import vào Visual Paradigm). Sửa diagram ở file nào thì cập nhật file còn lại cho khớp.
- [ ] **Thư mục & tên file** — mỗi thành viên một thư mục `final/diagrams/Mx_<Subsystem>_Diagrams/`:
  - Class: `class_diagrams/CD-xx_UC-yyy_<TenUC>.drawio` + `.txt`
  - Sequence: `sequence_diagrams/SD-xx_UC-yyy_<TenUC>.drawio` + `.txt`
  - Thư mục: `M1_Inventory-And-Pricing_Diagrams` · `M2_Auth-And-Administration_Diagrams` · `M3_Booking-And-Customer_Diagrams` · `M4_Billing-And-Payment_Diagrams` · `M5_Front-Desk-And-HR_Diagrams`
- [ ] **Ngôn ngữ trong diagram**: tiếng Anh (khớp tên class/route trong code).

Cột **Nguồn**:
- `code`: UC đã có trong code → vẽ theo code.
- `thiết kế`: code chưa có → tự thiết kế (route, method đặt tên theo quy ước code hiện tại).
- `spec`: UC đã có đặc tả chi tiết ở §4 system design. UC **không** có `spec` thì người phụ trách phải viết đặc tả trong SDS.

---

## 2. Phân công & checklist diagram

### M1 — Lê Trần Trọng Đạt · Inventory & Pricing

| CD | SD | # | Use case | UI – Controller – Model | Controller method | Nguồn |
|---|---|---|---|---|---|---|
| [x] | [x] | 01 | UC-M09 Update Room Info | RoomInventoryPage – RoomController – Room | `getRoom`, `updateRoom` (mới) | thiết kế |
| [x] | [x] | 02 | UC-R13 Update Room Status | RoomRackPage – FrontDeskController – Room | `updateRoomStatus` | code |
| [x] | [x] | 03 | UC-M20 Create Promotion Code | PromotionsPage – PromotionController – Promotion | `create` | code + spec (UC-M11) |
| [x] | [x] | 04 | UC-G11 Apply Discount Code | BookingWizardPage – PromotionController – Promotion | `validate` | code |

**Đặc tả UC cần viết thêm**: [x] UC-M09 (thiết kế trong SD-01) · [ ] UC-R13 · [ ] UC-G11

---

### M2 — ____________________ · Auth & Administration

| CD | SD | # | Use case | UI – Controller – Model | Controller method | Nguồn |
|---|---|---|---|---|---|---|
| [x] | [x] | 05 | UC-G17 Login | LoginPage – AuthController – User | `login` | code + spec |
| [x] | [x] | 06 | UC-G16 Register Account (+ Email) | RegisterPage – AuthController – User | `register`, `verifyEmail` | code + spec |
| [x] | [x] | 07 | UC-C03 Reset Forgotten Password (+ Email) | ForgotPasswordPage – AuthController – User | `forgotPassword`, `resetPassword` | code |
| [x] | [x] | 08 | UC-A06 Assign Role to Account | AccountsPage – AccountController – User, Role | `assignRole` | code + spec |

**Đặc tả UC cần viết thêm**: [ ] UC-C03

---

### M3 — ____________________ · Booking & Customer

| CD | SD | # | Use case | UI – Controller – Model | Controller method | Nguồn |
|---|---|---|---|---|---|---|
| [x] | [x] | 09 | UC-G01 Search Available Rooms | RoomSearchPage – RoomController – RoomType, Booking | `search` | code + spec |
| [x] | [x] | 10 | UC-G07 Book Room (+ payOS) | BookingWizardPage – BookingController – Booking | `create` | code + spec (rút gọn từ §6.3) |
| [x] | [x] | 11 | UC-G14 Cancel Booking | CustomerPages – BookingController – Booking | `cancel` | code + spec |
| [x] | [x] | 12 | UC-G13 Check Booking Status | BookingLookupPage – BookingController – Booking | `lookup` | code |

**Đặc tả UC cần viết thêm**: [ ] UC-G13

---

### M4 — ____________________ · Billing & Payment

| CD | SD | # | Use case | UI – Controller – Model | Controller method | Nguồn |
|---|---|---|---|---|---|---|
| [x] | [x] | 13 | UC-G10 Pay for Booking (+ payOS webhook) | PaymentResultPage – PaymentController – Payment | `webhook`, `reconcile` | code + spec |
| [x] | [x] | 14 | UC-R15 Process Payment | DeskPages (folio) – FrontDeskController – Folio, Payment | `takePayment` | code + spec |
| [x] | [x] | 15 | UC-C17 Request Refund | CustomerPages – RefundController – RefundRequest | `request` | code + spec |
| [x] | [x] | 16 | UC-M14 Approve Refund Request | ApprovalsPage – RefundController – RefundRequest | `pending`, `decide` | code |

**Đặc tả UC cần viết thêm**: [ ] UC-M14

---

### M5 — ____________________ · Front Desk & HR

| CD | SD | # | Use case | UI – Controller – Model | Controller method | Nguồn |
|---|---|---|---|---|---|---|
| [x] | [x] | 17 | UC-R06 Check In Guest | DeskPages – FrontDeskController – Booking, Room | `allocatableRooms`, `checkIn` | code + spec |
| [x] | [x] | 18 | UC-R09 Check Out Guest | DeskPages – FrontDeskController – Folio, Room | `checkOut` | code + spec |
| [x] | [x] | 19 | UC-E15 Submit Leave Request | MyLeavePage – LeaveController – LeaveRequest | `submit` | code |
| [x] | [x] | 20 | UC-M06 Approve / Reject Leave Request | ApprovalsPage – LeaveController – LeaveRequest | `pending`, `decide` | code + spec |

**Đặc tả UC cần viết thêm**: [ ] UC-E15

---

## 3. Tiến độ tổng

| Thành viên | Class (x/4) | Sequence (x/4) | Đặc tả UC bổ sung | Ảnh màn hình |
|---|---|---|---|---|
| M1 — Lê Trần Trọng Đạt | 4/4 | 4/4 | 1/3 | [ ] |
| M2 — ____________ | 4/4 | 4/4 | 0/1 | [ ] |
| M3 — ____________ | 4/4 | 4/4 | 0/1 | [ ] |
| M4 — ____________ | 4/4 | 4/4 | 0/1 | [ ] |
| M5 — ____________ | 4/4 | 4/4 | 0/1 | [ ] |
| **Tổng** | **20/20** | **20/20** | **1/7** | |

> Bản nháp 40 diagram do Codex vẽ (09/11/2026), đã đối chiếu cặp CD/SD tự động và chuyển sang `.drawio`. Mỗi thành viên vẫn cần **tự đọc lại** diagram của mình trước khi ghép SDS. Đã rút gọn (09/11/2026): mỗi SD còn 11–20 message, 1 luồng chính + 1 luồng thay thế; CD rút gọn theo SD.

---

## 4. Đối chiếu SDS mẫu → SDS mới

| Mục | SDS mẫu (v1.0) | Dự án hiện tại | Xử lý |
|---|---|---|---|
| Actor | Guest, Customer, Receptionist, Manager, VietQR, Gmail | + Employee, Admin; payOS (VietQR); Notification Service | Thay |
| Use case | UC1–UC50, có Blog, Chat AI, Contact Us | 124 UC (UC-G/C/E/R/M/A), 13 UC có đặc tả | Thay; bỏ Blog, Chat AI |
| Đặc tả UC | Bảng mẫu FPT | §4 system design, cùng trường | Giữ bảng mẫu, đổ nội dung mới |
| Database | ERD SQL, 26 bảng | MongoDB, 21 entity, 9 class diagram subsystem (`diagrams/class_diagrams/`) | Thay ERD bằng 9 class diagram + bảng collection |
| Màn hình | Ảnh thiết kế | Trang React thật | Chụp lại từ app |
| Kiến trúc | Không có (mục "III.2 Code Packages" ghi trong Record of Changes nhưng thiếu) | Layered, subsystem, package, deployment, API, quality, traceability | Thêm vào phần III |
| Phân quyền | Ma trận 3 vai trò | `ROLE_PERMISSIONS`, 6 vai trò | Thay |
| Class / Sequence theo UC | Không có | 1 sequence (§6.3) | Thêm 20 CD + 20 SD |
| State diagram | Không có | 2 state (§6.4 Booking, §6.5 Room) | Giữ nguyên 2 diagram có sẵn ở phần III, không vẽ thêm |

---

## 5. Khung SDS mới & vị trí diagram (checklist viết tài liệu)

- [ ] **Bìa · Record of Changes · Contents** (cập nhật version, ngày, thành viên)
- [ ] **I. Overview**
  - [ ] 1. System Context — context diagram (§5.1)
  - [ ] 2. User Requirements — 8 actor · 6 UC diagram (`diagrams/*.drawio`) · bảng 124 UC
  - [ ] 3. Main Workflows
  - [ ] 4. Overall Functionalities — screens flow · screen descriptions · phân quyền RBAC · Non-UI functions (timer, webhook, rules)
- [ ] **II. Functional Requirements** — theo actor; mỗi UC gồm:
  - Screen Design → UC Specification → **Class Diagram (CD-xx)** → **Sequence Diagram (SD-xx)**
- [ ] **III. System Design**
  - [ ] 1. Architecture — layered · subsystem · package diagram · deployment
  - [ ] 2. Database Design — 9 class diagram subsystem + mô tả collection
  - [ ] 3. State-Dependent Behaviour — Booking (§6.4), Room (§6.5)
  - [ ] 4. API Surface · Quality Attributes
- [ ] **Appendix — Traceability**: UC → CD-xx → SD-xx → file code

Lý do đặt: CD và SD cùng mô tả **một UC** (CD là cấu trúc, SD là tương tác giữa đúng các class đó) nên đặt liền nhau ngay sau đặc tả UC. 9 class diagram subsystem mô tả dữ liệu toàn hệ thống nên ở phần III.

---

## 6. Việc chuẩn bị trước khi ghép SDS

- [x] Đủ 40 diagram (`.drawio` + `.txt`) trong `final/diagrams/Mx_<Subsystem>_Diagrams/`
- [ ] 7 đặc tả UC bổ sung: UC-M09 ✔, UC-R13, UC-G11, UC-C03, UC-G13, UC-M14, UC-E15
- [ ] Ảnh chụp màn hình app cho Screen Design
- [ ] Điền tên 4 thành viên còn lại ở bảng **Thành viên** và Record of Changes
