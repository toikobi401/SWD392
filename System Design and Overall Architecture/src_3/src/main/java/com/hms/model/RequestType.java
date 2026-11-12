package com.hms.model;

public enum RequestType {
    LEAVE("Nghỉ phép"),
    SHIFT_SWAP("Đổi ca"),
    ATTENDANCE_CORRECTION("Sửa chấm công");

    private final String label;

    RequestType(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
