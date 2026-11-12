package com.hms.controller;

import com.hms.dao.EmployeeDAO;
import com.hms.dao.ScheduleDAO;
import com.hms.model.Shift;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

/**
 * Manage Work Schedule (include) Approve / Reject Leave Request,
 * extended by Approve Shift Swap Request and Approve Attendance Correction (extended by Approve Payroll).
 */
@WebServlet("/manager/schedule")
public class ScheduleServlet extends BaseServlet {
    private final EmployeeDAO employeeDAO = EmployeeDAO.INSTANCE;
    private final ScheduleDAO scheduleDAO = ScheduleDAO.INSTANCE;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        request.setAttribute("employees", employeeDAO.findAll());
        request.setAttribute("employeesById", employeeDAO.findAllById());
        request.setAttribute("shiftNames", Shift.NAMES);
        request.setAttribute("shifts", scheduleDAO.findAllShifts());
        request.setAttribute("requests", scheduleDAO.findAllRequests());
        request.setAttribute("payrolls", scheduleDAO.findAllPayrolls());
        render(request, response, "schedule");
    }

    @Override
    protected String handle(String action, HttpServletRequest request) {
        switch (String.valueOf(action)) {
            case "addShift": {
                int employeeId = employeeDAO.findById(positiveInt(request, "employeeId")).getId();
                scheduleDAO.addShift(employeeId, date(request, "date"), text(request, "shiftName"));
                return "Đã xếp ca làm việc";
            }
            case "approveRequest":
            case "rejectRequest": {
                int requestId = positiveInt(request, "requestId");
                boolean approve = action.equals("approveRequest");
                scheduleDAO.decideRequest(requestId, approve);
                return (approve ? "Đã duyệt" : "Đã từ chối") + " yêu cầu #" + requestId;
            }
            case "approvePayroll": {
                int payrollId = positiveInt(request, "payrollId");
                scheduleDAO.approvePayroll(payrollId);
                return "Đã duyệt bảng lương #" + payrollId;
            }
            default:
                throw unknownAction(action);
        }
    }
}
