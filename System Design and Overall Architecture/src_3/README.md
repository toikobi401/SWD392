# HMS – Manager module (Java Servlet + JSP, MVC)

Dự án mẫu cho các use case của actor **Manager** trong sơ đồ use case *Hotel Management System*.
Dữ liệu được lưu tạm trong bộ nhớ (mất khi khởi động lại server).

## Cấu trúc

```
src/main/java/com/hms/
├── model/        # M – entity: Employee, SalaryGrade, Allowance, Shift, StaffRequest, Payroll, RoomType, Room, HotelService
├── dao/          # M – truy xuất dữ liệu (in-memory): EmployeeDAO, SalaryDAO, ScheduleDAO, RoomDAO
└── controller/   # C – Servlet: BaseServlet, SalaryServlet, ScheduleServlet, RoomServlet
src/main/webapp/
├── index.jsp
└── WEB-INF/views/ # V – JSP: salary.jsp, schedule.jsp, rooms.jsp, common/header.jspf, common/footer.jspf
```

Luồng xử lý: `GET` → Servlet lấy dữ liệu từ DAO → forward sang JSP.
`POST` (tham số `action`) → Servlet gọi DAO → redirect về trang (Post/Redirect/Get) kèm thông báo.

## Ánh xạ use case → code

| Use case | URL / action | Quan hệ |
|---|---|---|
| Manage Salary Structure | `/manager/salary` · `updateGrade` | |
| Adjust Employee Salary | `/manager/salary` · `adjustSalary` (lương mới phải nằm trong khung) | «include» từ Manage Salary Structure |
| Manage Bonus / Allowance | `/manager/salary` · `addAllowance` | «extend» Adjust Employee Salary |
| View Employee Performance | `/manager/salary` (cột Hiệu suất) | «extend» Adjust Employee Salary |
| Manage Work Schedule | `/manager/schedule` · `addShift` | |
| Approve / Reject Leave Request | `/manager/schedule` · `approveRequest` / `rejectRequest` (duyệt nghỉ → xóa ca ngày đó) | «include» từ Manage Work Schedule |
| Approve Shift Swap Request | như trên, loại `SHIFT_SWAP` | «extend» Approve / Reject Leave |
| Approve Attendance Correction | như trên, loại `ATTENDANCE_CORRECTION` | «extend» Approve / Reject Leave |
| Approve Payroll | `/manager/schedule` · `approvePayroll` (bị chặn khi còn yêu cầu sửa chấm công chờ duyệt) | «extend» Approve Attendance Correction |
| Manage Room Inventory | `/manager/rooms` · `addRoom`, `updateRoomStatus` | |
| Manage Room Type / Pricing | `/manager/rooms` · `addRoomType`, `updatePrice` | «include» từ Manage Room Inventory |
| Manage Hotel Services | `/manager/rooms` · `addService`, `deleteService` | «extend» Manage Room Type / Pricing |

## Chạy

Yêu cầu JDK 17, Maven, Tomcat 10.1+ (Jakarta Servlet 6).

```bash
mvn test        # chạy unit test cho quy tắc nghiệp vụ
mvn package     # tạo target/hms-manager-mvc.war
```

Deploy file WAR vào Tomcat rồi mở `http://localhost:8080/hms-manager-mvc/`.
