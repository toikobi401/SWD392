package com.hms.model;

public class SalaryGrade {
    private final String code;
    private final String position;
    private long minSalary;
    private long maxSalary;

    public SalaryGrade(String code, String position, long minSalary, long maxSalary) {
        this.code = code;
        this.position = position;
        this.minSalary = minSalary;
        this.maxSalary = maxSalary;
    }

    public boolean contains(long salary) {
        return salary >= minSalary && salary <= maxSalary;
    }

    public String getCode() {
        return code;
    }

    public String getPosition() {
        return position;
    }

    public long getMinSalary() {
        return minSalary;
    }

    public long getMaxSalary() {
        return maxSalary;
    }

    public void setRange(long minSalary, long maxSalary) {
        this.minSalary = minSalary;
        this.maxSalary = maxSalary;
    }
}
