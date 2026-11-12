# AGENTS.md — HotelHub (SWD392)

Quy tắc chung và bối cảnh cho **mọi AI agent** làm việc trong repo này: Claude Code, Codex, Cursor,
Copilot, Antigravity, Gemini CLI. **Quy tắc ở đây thắng hành vi mặc định của agent.** File này chỉ tóm
tắt và trỏ tới tài liệu gốc — chi tiết nằm ở đó, đừng chép sang đây.

> Đây là **nguồn sự thật duy nhất** cho chỉ dẫn agent. `CLAUDE.md`, `.claude/`, `.agents/` chỉ nối công
> cụ tương ứng vào file này (§5). Sửa quy tắc thì sửa ở đây.

---

## 1. Quy tắc chung

### R1 — Bám tài liệu thiết kế và code, không bịa

Mọi tên actor, mã use case, quy tắc nghiệp vụ (BR-xx), tên class, method, route, thuộc tính đưa vào sơ
đồ hay tài liệu phải tra được ở một trong hai nguồn:

- **Tài liệu thiết kế** `System Design and Overall Architecture/System Design and Overall Architecture.md`
  (gọi tắt là **SDA**): actor, use case, đặc tả, mô hình, kiến trúc.
- **Code** trong `System Design and Overall Architecture/src/`: tên và kiểu thật. Thuộc tính của entity
  lấy từ `src/server/src/models/*.model.ts`.

Hai nguồn lệch nhau thì **nói ra**, không tự chọn một bên rồi im lặng. Use case chưa có trong code thì
ghi rõ là "thiết kế" (xem cột **Nguồn** trong checklist, §3).

### R2 — Một nguồn sự thật: trỏ tới, đừng chép

Trỏ bằng tên file và số mục (SDA §4, checklist §1), không chép nguyên đoạn sang chỗ khác. Con số hay đổi
(tiến độ, số diagram đã xong, ai làm gì) chỉ nằm trong checklist — đừng chép vào đây.

### R3 — Nghiên cứu trước, trả lời sau

Thông tin dùng để ra quyết định (phiên bản thư viện, khả năng của API như payOS, giấy phép, quy định môn
học) phải tra nguồn gốc trước khi trả lời: tài liệu chính thức, mã nguồn, slide môn học. Không tra được
thì nói thẳng **"chưa kiểm chứng"**, đừng trình bày như sự thật.

### R4 — Không commit, không push khi chưa được yêu cầu

Repo dùng chung cho cả nhóm, làm thẳng trên `master` (`origin` = github.com/toikobi401/SWD392). Commit chỉ
khi người dùng bảo. Commit message theo kiểu đang dùng trong `git log`: **tiếng Anh, chữ thường, câu mệnh
lệnh ngắn** (VD `simplify sequence diagrams to one main and one alternative flow`).

### R5 — Ngôn ngữ

- Trả lời người dùng và viết tài liệu nội bộ (checklist, ghi chú): **tiếng Việt**.
- Nhãn trong sơ đồ, tên định danh trong code, mã use case, mã actor: **tiếng Anh** (checklist §1).

### R6 — Mơ hồ thì hỏi, không tự suy diễn

Phạm vi, đối tượng đọc, mục đích hay một câu có nhiều cách hiểu thì **hỏi trước khi làm**. Không tự chọn
một cách hiểu rồi lan sang file khác. Đã lỡ suy diễn thì nói rõ phần nào là suy diễn.

### R7 — Bí mật và tài liệu môn học

- **Không đọc, không in, không commit** `src/server/.env` — nó chứa khoá payOS và JWT secret thật. Tên
  biến xem ở `.env.example`.
- `class_material/` (slide và tài liệu của môn) đã nằm trong `.gitignore` — đọc để tra thuật ngữ thì
  được, **không commit, không đưa lên dịch vụ ngoài**.
- Không dán code hay tài liệu của nhóm lên dịch vụ bên ngoài (pastebin, công cụ tóm tắt trực tuyến) khi
  chưa được yêu cầu.

### R8 — Thêm thư viện phải hỏi trước

Trước khi thêm dependency vào `package.json` hay `pom.xml`: hỏi, nêu lý do, giấy phép, kích thước. Ưu
tiên thứ đã có trong dự án.

### R9 — Chưa kiểm thì không báo "xong"

Báo đúng những gì đã chạy và kết quả của nó (lệnh ở §4). Không chạy được thì nói "chưa chạy, vì…", không
coi là đạt. Với sơ đồ: phải mở xem được bản render (§4.3), không chỉ kiểm XML hợp lệ.

---

## 2. Bối cảnh dự án

**HotelHub Management System** — bài tập nhóm môn **SWD392 (Software Architecture and Design)**. Sản phẩm
nộp là bản **SDS** (Requirement & Design Specification) cùng bộ sơ đồ, theo mẫu
`final/Requirement & Design Specification sample.docx`. Phương pháp mô hình hoá theo giáo trình của môn
(COMET của Gomaa — SDA ghi số chương, VD "Ch. 7"); slide từng chương ở `class_material/`.

- **Nhóm 5 người**, mỗi người một subsystem (M1–M5), mỗi người 4 use case × (1 class diagram + 1 sequence
  diagram) = 40 sơ đồ. Phân công, tiến độ và việc còn lại: **checklist** §Thành viên, §2, §3, §6.
- **Actor:** Guest, Customer, Employee, Receptionist, Manager, Admin; hệ thống ngoài payOS (VietQR),
  Email/SMS Service, Google OAuth (đăng nhập Google — SDA UC-G17, luồng 1.1). Chi tiết: SDA §2, §5.1.
- **Use case:** 124 UC mã `UC-G/C/E/R/M/A..` (SDA §3), 13 UC có đặc tả chi tiết (SDA §4).
- **Công nghệ của code mẫu:** React 18 + Vite · Node.js + Express + TypeScript · MongoDB + Mongoose · JWT
  + bcrypt · payOS (SDA §1.3).

### Bản đồ repo

| Đường dẫn | Nội dung |
|---|---|
| `System Design and Overall Architecture/System Design and Overall Architecture.md` (+ `.pdf`) | **SDA — nguồn sự thật thiết kế.** §2 actor · §3 danh mục 124 UC · §4 đặc tả 13 UC · §5 mô hình tĩnh, context, entity · §6 phân loại đối tượng, sequence UC-G07, state machine Booking/Room · §7 kiến trúc, subsystem, package, deployment, API · §8 thuộc tính chất lượng · §9 traceability |
| `…/src/server` | API Express + Mongoose: `models` (entity), `controllers`, `services` (coordinator), `rules` (business logic), `proxies` (payOS, notification), `routes`. Test e2e ở `test/smoke.e2e.js` |
| `…/src/client` | Web React + Vite (cổng 3001, proxy `/api` sang server) |
| `…/src_2` | Mẫu Java Servlet + JSP tối giản (danh sách phòng) |
| `…/src_3` | Mẫu Java Servlet + JSP theo MVC cho 12 UC của Manager (lương, lịch làm việc, phòng), dữ liệu trong bộ nhớ — `README.md` có bảng UC → code |
| `diagrams/` | 6 use case diagram theo actor (`Guest.drawio`…) · `package_diagram.drawio` · `class_diagrams/` 9 class diagram theo subsystem · `sequence_diagrams/` (UC-M09 là **mẫu trình bày** cho mọi SD) |
| `final/SDS_HotelHub_v2.docx` | Bản SDS đang nộp |
| `final/SDS_Diagram_Checklist.md` | **Checklist:** phân công, **quy ước vẽ CD/SD (§1)**, bảng UC từng người, tiến độ, khung SDS và vị trí từng sơ đồ (§5) |
| `final/diagrams/` | `Context_Diagram_HotelHub.drawio`, `ERD_HotelHub.drawio` (crow's foot toàn hệ thống), `AI_Agent_Configuration.drawio` (agent nào đọc file cấu hình nào — SDS mục IV), và `Mx_<Subsystem>_Diagrams/` chứa CD-xx, SD-xx (`.drawio` + `.txt` PlantUML) |
| `class_material/` | Slide môn học — chỉ đọc, không commit (R7) |

---

## 3. Khi vẽ hoặc sửa sơ đồ

- **Quy ước CD/SD là checklist §1** — đọc trước khi vẽ: 7 lifeline `Actor – UI page – Router – Controller –
  Service – Model – DB` (request đi qua `routes/` và `services/` như code), đúng một khung `alt` hai nhánh,
  Router một self-call ghi middleware thật, CD chỉ chứa class có mặt trong SD cùng số, cách đặt tên file. Đừng
  chép lại các luật đó vào chỗ khác (R2).
- **CD-xx và SD-xx cùng số là cùng một use case** và phải khớp nhau: mỗi lifeline là một class trong CD,
  mỗi bước gọi ứng với một method.
- Mỗi sơ đồ trong `final/diagrams/Mx_*` có **hai file cùng tên** `.drawio` + `.txt` (PlantUML, để import
  Visual Paradigm). Sửa file nào thì cập nhật file kia cho khớp.
- Trình bày theo mẫu `diagrams/sequence_diagrams/UC-M09_Update_Room_Info_SequenceDiagram.drawio`.
- Đường nối không được cắt ngang hộp/bảng; nhãn không được chồng nhau. Kiểm bằng bản render (§4.3).
- Thêm sơ đồ mới vào SDS thì cập nhật checklist §5 (vị trí trong SDS) trong cùng lần thay đổi.

---

## 4. Lệnh chạy và cách kiểm

### 4.1 Server (`System Design and Overall Architecture/src/server`)

| Việc | Lệnh |
|---|---|
| Cài | `npm install`; chép `.env.example` → `.env` rồi điền (R7) |
| Chạy dev (cổng 3000) | `npm run dev` |
| Nạp dữ liệu | `npm run seed` · dữ liệu demo: `npm run seed:demo` |
| Kiểm kiểu | `npm run typecheck` |
| Test | `npm test` — build rồi chạy `test/smoke.e2e.js` trên MongoDB trong bộ nhớ và một payOS giả; không cần MongoDB thật |

### 4.2 Client (`System Design and Overall Architecture/src/client`)

`npm install` · `npm run dev` (cổng 3001) · `npm run typecheck` · `npm run build`.

### 4.3 Sơ đồ `.drawio`

- Máy dev không có draw.io desktop, nên không xuất PNG bằng dòng lệnh được. Xuất ảnh để chèn SDS: mở file
  trong draw.io → File → Export as → PNG.
- Xem bản render để kiểm: mở bằng draw.io (web hoặc extension VS Code), hoặc nén XML vào phần `#R…` của
  `https://viewer.diagrams.net/?lightbox=1#R…`. Phần sau `#` không được gửi lên server.
- Kiểm XML hợp lệ trước khi mở: `python -c "import xml.dom.minidom,sys;xml.dom.minidom.parse(sys.argv[1])" <file>`.

### 4.4 Java (`src_2`, `src_3`)

`mvn package` ra file WAR cho Tomcat 10.1+ (Jakarta Servlet 6, JDK 17). Máy dev có JDK 17 nhưng **chưa
cài Maven**; muốn kiểm thì biên dịch bằng `javac` với jar trong `~/.m2/repository`.

---

## 5. Cấu hình agent trong repo

Mỗi công cụ đọc một chỗ khác nhau; tất cả quy về file này.

| Công cụ | Đọc gì | Ghi chú |
|---|---|---|
| Codex, Cursor, Copilot (VS Code), Antigravity | `AGENTS.md` trực tiếp | Copilot: bật `chat.useAgentsMdFile` |
| Claude Code | `CLAUDE.md` → import `@AGENTS.md`; `.claude/rules/`, `.claude/skills/`, `.claude/settings.json` | Có `CLAUDE.md` thì Claude Code **không** tự đọc `AGENTS.md` — phải import |
| Antigravity | `.agents/rules/`, `.agents/skills/` | |
| Codex | `.agents/skills/` | |

**Skill** (bản gốc ở `.agents/skills/<tên>/SKILL.md`; `.claude/skills/` chỉ trỏ sang):

| Skill | Khi nào dùng |
|---|---|
| `brainstorming` | Trước việc sáng tạo: thêm chức năng, dựng màn mới, lập kế hoạch |
| `writing-plans` · `executing-plans` | Việc nhiều bước: viết kế hoạch trước khi chạm code, rồi tự thực thi |
| `subagent-driven-development` · `dispatching-parallel-agents` | Chia việc độc lập cho sub-agent — sub-agent **luôn dùng Sonnet** (`.claude/rules/sub-agent.md`) |
| `systematic-debugging` | Gặp bug, test đỏ, hành vi lạ — trước khi đề xuất bản sửa |
| `verification-before-completion` | Trước khi nói "xong" (R9) |
| `ponytail` · `ponytail-review` · `ponytail-audit` · `ponytail-debt` | Thay đổi nhỏ nhất đủ việc; review một diff; audit cả repo; gom comment `shortcut:` |
| `vietnamese-tech-writing` | Viết/soát tiếng Việt cho tài liệu, checklist, microcopy |
| `vietnamese-*` khác | Copy marketing, tài chính, giáo dục — dự án này gần như không cần |

Các skill `superpowers` (`brainstorming`…`verification-before-completion`), `ponytail*` và `vietnamese-*`
là mã bên thứ ba giấy phép MIT, chép nguyên văn (`LICENSE` trong từng thư mục) — không sửa tay.

> ⚠️ **Chưa chuyển sang dự án này** (sao từ dự án khác, trỏ tới `docs/`, Go, MeshCentral không tồn tại ở
> đây): skill `done-gates`, `record-decision`, `research-verify`, `add-dependency`, `drawio-diagram`, và
> rule `go-code.md`, `agent-protocol.md`, `docs.md` (trong cả `.claude/rules/` và `.agents/rules/`). **Đừng
> làm theo chúng**; khi cần, dùng §3 và §4 của file này. Ba rule kia chỉ nạp theo đường dẫn không có trong
> repo nên hiện không bao giờ kích hoạt.

Cấu hình cá nhân không commit: `CLAUDE.local.md`, `.claude/settings.local.json`.
