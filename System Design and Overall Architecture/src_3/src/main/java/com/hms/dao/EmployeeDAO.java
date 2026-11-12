package com.hms.dao;

import com.hms.model.Employee;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// shortcut: every DAO keeps data in memory (lost on restart); swap the method bodies for JDBC when a database is added.
public class EmployeeDAO {
    public static final EmployeeDAO INSTANCE = new EmployeeDAO();

    private final Map<Integer, Employee> employees = new LinkedHashMap<>();

    public EmployeeDAO() {
        add(new Employee(1, "Nguyễn Văn An", "Lễ tân", "FO1", 4.2, 8_000_000));
        add(new Employee(2, "Trần Thị Bình", "Buồng phòng", "HK1", 3.8, 7_000_000));
        add(new Employee(3, "Lê Minh Cường", "Bảo vệ", "SC1", 4.5, 6_500_000));
    }

    private void add(Employee employee) {
        employees.put(employee.getId(), employee);
    }

    public synchronized List<Employee> findAll() {
        return List.copyOf(employees.values());
    }

    public synchronized Map<Integer, Employee> findAllById() {
        return Map.copyOf(employees);
    }

    public synchronized Employee findById(int id) {
        Employee employee = employees.get(id);
        if (employee == null) {
            throw new IllegalArgumentException("Không tìm thấy nhân viên #" + id);
        }
        return employee;
    }

    public synchronized void updateSalary(int id, long newSalary) {
        findById(id).setBaseSalary(newSalary);
    }
}
