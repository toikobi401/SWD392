package com.hms.dao;

import com.hms.model.Allowance;
import com.hms.model.SalaryGrade;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class SalaryDAO {
    public static final SalaryDAO INSTANCE = new SalaryDAO();

    private final Map<String, SalaryGrade> grades = new LinkedHashMap<>();
    private final List<Allowance> allowances = new ArrayList<>();
    private int nextAllowanceId = 1;

    public SalaryDAO() {
        grades.put("FO1", new SalaryGrade("FO1", "Lễ tân", 7_000_000, 12_000_000));
        grades.put("HK1", new SalaryGrade("HK1", "Buồng phòng", 6_000_000, 10_000_000));
        grades.put("SC1", new SalaryGrade("SC1", "Bảo vệ", 6_000_000, 9_000_000));
        addAllowance(1, "ALLOWANCE", 500_000, "Phụ cấp ăn trưa");
    }

    public synchronized List<SalaryGrade> findAllGrades() {
        return List.copyOf(grades.values());
    }

    public synchronized SalaryGrade findGrade(String code) {
        SalaryGrade grade = grades.get(code);
        if (grade == null) {
            throw new IllegalArgumentException("Không tìm thấy khung lương " + code);
        }
        return grade;
    }

    public synchronized void updateGradeRange(String code, long minSalary, long maxSalary) {
        if (minSalary > maxSalary) {
            throw new IllegalArgumentException("Lương tối thiểu phải nhỏ hơn hoặc bằng lương tối đa");
        }
        findGrade(code).setRange(minSalary, maxSalary);
    }

    public synchronized List<Allowance> findAllAllowances() {
        return List.copyOf(allowances);
    }

    public synchronized void addAllowance(int employeeId, String type, long amount, String reason) {
        if (!Allowance.TYPES.contains(type)) {
            throw new IllegalArgumentException("Loại khoản không hợp lệ: " + type);
        }
        allowances.add(new Allowance(nextAllowanceId++, employeeId, type, amount, reason));
    }
}
