package com.hms.dao;

import com.hms.model.ApprovalStatus;
import com.hms.model.Payroll;
import com.hms.model.RequestType;
import com.hms.model.Shift;
import com.hms.model.StaffRequest;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

public class ScheduleDAO {
    public static final ScheduleDAO INSTANCE = new ScheduleDAO();

    private final List<Shift> shifts = new ArrayList<>();
    private final List<StaffRequest> requests = new ArrayList<>();
    private final List<Payroll> payrolls = new ArrayList<>();
    private int nextShiftId = 1;

    public ScheduleDAO() {
        LocalDate tomorrow = LocalDate.now().plusDays(1);
        addShift(1, tomorrow, "Sáng");
        addShift(2, tomorrow, "Chiều");
        addShift(3, tomorrow, "Đêm");

        requests.add(new StaffRequest(1, 1, RequestType.LEAVE, tomorrow, "Nghỉ ốm"));
        requests.add(new StaffRequest(2, 2, RequestType.SHIFT_SWAP, tomorrow.plusDays(1), "Đổi ca chiều sang ca sáng"));
        requests.add(new StaffRequest(3, 3, RequestType.ATTENDANCE_CORRECTION, LocalDate.now().minusDays(1), "Quên chấm công ra"));

        String period = YearMonth.now().toString();
        payrolls.add(new Payroll(1, 1, period, 8_500_000));
        payrolls.add(new Payroll(2, 2, period, 7_000_000));
        payrolls.add(new Payroll(3, 3, period, 6_500_000));
    }

    public synchronized List<Shift> findAllShifts() {
        return List.copyOf(shifts);
    }

    public synchronized void addShift(int employeeId, LocalDate date, String shiftName) {
        if (!Shift.NAMES.contains(shiftName)) {
            throw new IllegalArgumentException("Ca làm không hợp lệ: " + shiftName);
        }
        if (shifts.stream().anyMatch(s -> s.getEmployeeId() == employeeId && s.getDate().equals(date))) {
            throw new IllegalArgumentException("Nhân viên #" + employeeId + " đã có ca vào ngày " + date);
        }
        shifts.add(new Shift(nextShiftId++, employeeId, date, shiftName));
    }

    public synchronized List<StaffRequest> findAllRequests() {
        return List.copyOf(requests);
    }

    public synchronized void decideRequest(int requestId, boolean approve) {
        StaffRequest request = requests.stream()
                .filter(r -> r.getId() == requestId)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy yêu cầu #" + requestId));
        if (request.getStatus() != ApprovalStatus.PENDING) {
            throw new IllegalArgumentException("Yêu cầu #" + requestId + " đã được xử lý");
        }
        request.setStatus(approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED);
        if (approve && request.getType() == RequestType.LEAVE) {
            // Approved leave frees the employee's slot in the work schedule.
            shifts.removeIf(s -> s.getEmployeeId() == request.getEmployeeId() && s.getDate().equals(request.getDate()));
        }
    }

    public synchronized List<Payroll> findAllPayrolls() {
        return List.copyOf(payrolls);
    }

    public synchronized void approvePayroll(int payrollId) {
        Payroll payroll = payrolls.stream()
                .filter(p -> p.getId() == payrollId)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy bảng lương #" + payrollId));
        if (payroll.getStatus() != ApprovalStatus.PENDING) {
            throw new IllegalArgumentException("Bảng lương #" + payrollId + " đã được duyệt");
        }
        boolean hasPendingCorrection = requests.stream().anyMatch(r -> r.getEmployeeId() == payroll.getEmployeeId()
                && r.getType() == RequestType.ATTENDANCE_CORRECTION
                && r.getStatus() == ApprovalStatus.PENDING);
        if (hasPendingCorrection) {
            throw new IllegalArgumentException("Cần xử lý yêu cầu sửa chấm công của nhân viên #"
                    + payroll.getEmployeeId() + " trước khi duyệt lương");
        }
        payroll.setStatus(ApprovalStatus.APPROVED);
    }
}
