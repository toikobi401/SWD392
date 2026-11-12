package com.hms.model;

import java.util.List;

public class Room {
    public static final List<String> STATUSES = List.of("Available", "Occupied", "Maintenance");

    private final String roomNumber;
    private final int roomTypeId;
    private String status;

    public Room(String roomNumber, int roomTypeId, String status) {
        this.roomNumber = roomNumber;
        this.roomTypeId = roomTypeId;
        this.status = status;
    }

    public String getRoomNumber() {
        return roomNumber;
    }

    public int getRoomTypeId() {
        return roomTypeId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
