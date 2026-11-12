package com.hms.model;

public class Room {
    private final String roomNumber;
    private final String roomType;
    private final int capacity;
    private final long pricePerNight;
    private final String status;

    public Room(String roomNumber, String roomType, int capacity, long pricePerNight, String status) {
        this.roomNumber = roomNumber;
        this.roomType = roomType;
        this.capacity = capacity;
        this.pricePerNight = pricePerNight;
        this.status = status;
    }

    public String getRoomNumber() {
        return roomNumber;
    }

    public String getRoomType() {
        return roomType;
    }

    public int getCapacity() {
        return capacity;
    }

    public long getPricePerNight() {
        return pricePerNight;
    }

    public String getStatus() {
        return status;
    }
}