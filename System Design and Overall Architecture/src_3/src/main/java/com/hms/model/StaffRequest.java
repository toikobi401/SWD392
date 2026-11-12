package com.hms.model;

import java.time.LocalDate;

/** Leave, shift-swap and attendance-correction requests share one shape; only the type differs. */
public class StaffRequest {
    private final int id;
    private final int employeeId;
    private final RequestType type;
    private final LocalDate date;
    private final String detail;
    private ApprovalStatus status = ApprovalStatus.PENDING;

    public StaffRequest(int id, int employeeId, RequestType type, LocalDate date, String detail) {
        this.id = id;
        this.employeeId = employeeId;
        this.type = type;
        this.date = date;
        this.detail = detail;
    }

    public int getId() {
        return id;
    }

    public int getEmployeeId() {
        return employeeId;
    }

    public RequestType getType() {
        return type;
    }

    public LocalDate getDate() {
        return date;
    }

    public String getDetail() {
        return detail;
    }

    public ApprovalStatus getStatus() {
        return status;
    }

    public void setStatus(ApprovalStatus status) {
        this.status = status;
    }
}
