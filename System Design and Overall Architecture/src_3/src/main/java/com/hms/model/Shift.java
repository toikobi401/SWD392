package com.hms.model;

import java.time.LocalDate;
import java.util.List;

public class Shift {
    public static final List<String> NAMES = List.of("Sáng", "Chiều", "Đêm");

    private final int id;
    private final int employeeId;
    private final LocalDate date;
    private final String shiftName;

    public Shift(int id, int employeeId, LocalDate date, String shiftName) {
        this.id = id;
        this.employeeId = employeeId;
        this.date = date;
        this.shiftName = shiftName;
    }

    public int getId() {
        return id;
    }

    public int getEmployeeId() {
        return employeeId;
    }

    public LocalDate getDate() {
        return date;
    }

    public String getShiftName() {
        return shiftName;
    }
}
