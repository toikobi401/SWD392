package com.hms.dao;

import com.hms.model.ApprovalStatus;
import com.hms.model.SalaryGrade;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScheduleDAOTest {

    @Test
    void payrollIsBlockedUntilAttendanceCorrectionIsDecided() {
        ScheduleDAO dao = new ScheduleDAO(); // seed: request #3 is a pending correction for employee #3, payroll #3
        assertThrows(IllegalArgumentException.class, () -> dao.approvePayroll(3));

        dao.decideRequest(3, false);
        dao.approvePayroll(3);
        assertEquals(ApprovalStatus.APPROVED, dao.findAllPayrolls().get(2).getStatus());
    }

    @Test
    void approvedLeaveRemovesShiftAndCannotBeDecidedTwice() {
        ScheduleDAO dao = new ScheduleDAO(); // seed: request #1 is leave for employee #1 tomorrow, who has a shift then
        LocalDate tomorrow = LocalDate.now().plusDays(1);

        dao.decideRequest(1, true);
        assertFalse(dao.findAllShifts().stream()
                .anyMatch(s -> s.getEmployeeId() == 1 && s.getDate().equals(tomorrow)));
        assertThrows(IllegalArgumentException.class, () -> dao.decideRequest(1, false));
    }

    @Test
    void duplicateShiftOnSameDayIsRejected() {
        ScheduleDAO dao = new ScheduleDAO();
        assertThrows(IllegalArgumentException.class, () -> dao.addShift(2, LocalDate.now().plusDays(1), "Sáng"));
    }

    @Test
    void salaryGradeRangeIsInclusive() {
        SalaryGrade grade = new SalaryGrade("X", "Test", 100, 200);
        assertTrue(grade.contains(100));
        assertTrue(grade.contains(200));
        assertFalse(grade.contains(201));
    }
}
