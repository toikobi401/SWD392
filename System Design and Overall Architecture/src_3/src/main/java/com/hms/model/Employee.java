package com.hms.model;

public class Employee {
    private final int id;
    private final String name;
    private final String position;
    private final String gradeCode;
    private final double performanceScore;
    private long baseSalary;

    public Employee(int id, String name, String position, String gradeCode, double performanceScore, long baseSalary) {
        this.id = id;
        this.name = name;
        this.position = position;
        this.gradeCode = gradeCode;
        this.performanceScore = performanceScore;
        this.baseSalary = baseSalary;
    }

    public int getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getPosition() {
        return position;
    }

    public String getGradeCode() {
        return gradeCode;
    }

    public double getPerformanceScore() {
        return performanceScore;
    }

    public long getBaseSalary() {
        return baseSalary;
    }

    public void setBaseSalary(long baseSalary) {
        this.baseSalary = baseSalary;
    }
}
