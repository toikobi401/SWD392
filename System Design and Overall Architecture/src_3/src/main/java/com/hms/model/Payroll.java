package com.hms.model;

public class Payroll {
    private final int id;
    private final int employeeId;
    private final String period;
    private final long amount;
    private ApprovalStatus status = ApprovalStatus.PENDING;

    public Payroll(int id, int employeeId, String period, long amount) {
        this.id = id;
        this.employeeId = employeeId;
        this.period = period;
        this.amount = amount;
    }

    public int getId() {
        return id;
    }

    public int getEmployeeId() {
        return employeeId;
    }

    public String getPeriod() {
        return period;
    }

    public long getAmount() {
        return amount;
    }

    public ApprovalStatus getStatus() {
        return status;
    }

    public void setStatus(ApprovalStatus status) {
        this.status = status;
    }
}
