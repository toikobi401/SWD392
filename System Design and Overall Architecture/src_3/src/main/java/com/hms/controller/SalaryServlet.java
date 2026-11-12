package com.hms.controller;

import com.hms.dao.EmployeeDAO;
import com.hms.dao.SalaryDAO;
import com.hms.model.Employee;
import com.hms.model.SalaryGrade;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

/**
 * Manage Salary Structure (include) Adjust Employee Salary,
 * extended by Manage Bonus / Allowance and View Employee Performance.
 */
@WebServlet("/manager/salary")
public class SalaryServlet extends BaseServlet {
    private final EmployeeDAO employeeDAO = EmployeeDAO.INSTANCE;
    private final SalaryDAO salaryDAO = SalaryDAO.INSTANCE;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        request.setAttribute("grades", salaryDAO.findAllGrades());
        request.setAttribute("employees", employeeDAO.findAll());
        request.setAttribute("employeesById", employeeDAO.findAllById());
        request.setAttribute("allowances", salaryDAO.findAllAllowances());
        render(request, response, "salary");
    }

    @Override
    protected String handle(String action, HttpServletRequest request) {
        switch (String.valueOf(action)) {
            case "updateGrade": {
                String code = text(request, "code");
                salaryDAO.updateGradeRange(code, positiveLong(request, "minSalary"), positiveLong(request, "maxSalary"));
                return "Đã cập nhật khung lương " + code;
            }
            case "adjustSalary": {
                Employee employee = employeeDAO.findById(positiveInt(request, "employeeId"));
                long newSalary = positiveLong(request, "newSalary");
                SalaryGrade grade = salaryDAO.findGrade(employee.getGradeCode());
                if (!grade.contains(newSalary)) {
                    throw new IllegalArgumentException(String.format("Lương mới phải nằm trong khung %s: %,d - %,d đ",
                            grade.getCode(), grade.getMinSalary(), grade.getMaxSalary()));
                }
                employeeDAO.updateSalary(employee.getId(), newSalary);
                return "Đã điều chỉnh lương cho " + employee.getName();
            }
            case "addAllowance": {
                Employee employee = employeeDAO.findById(positiveInt(request, "employeeId"));
                salaryDAO.addAllowance(employee.getId(), text(request, "type"),
                        positiveLong(request, "amount"), text(request, "reason"));
                return "Đã thêm khoản thưởng/phụ cấp cho " + employee.getName();
            }
            default:
                throw unknownAction(action);
        }
    }
}
