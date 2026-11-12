package com.hms.model;

import java.util.List;

public class Allowance {
    public static final List<String> TYPES = List.of("BONUS", "ALLOWANCE");

    private final int id;
    private final int employeeId;
    private final String type;
    private final long amount;
    private final String reason;

    public Allowance(int id, int employeeId, String type, long amount, String reason) {
        this.id = id;
        this.employeeId = employeeId;
        this.type = type;
        this.amount = amount;
        this.reason = reason;
    }

    public int getId() {
        return id;
    }

    public int getEmployeeId() {
        return employeeId;
    }

    public String getType() {
        return type;
    }

    public long getAmount() {
        return amount;
    }

    public String getReason() {
        return reason;
    }
}
