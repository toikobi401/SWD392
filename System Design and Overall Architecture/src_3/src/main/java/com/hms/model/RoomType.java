package com.hms.model;

public class RoomType {
    private final int id;
    private final String name;
    private final int capacity;
    private long pricePerNight;

    public RoomType(int id, String name, int capacity, long pricePerNight) {
        this.id = id;
        this.name = name;
        this.capacity = capacity;
        this.pricePerNight = pricePerNight;
    }

    public int getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public int getCapacity() {
        return capacity;
    }

    public long getPricePerNight() {
        return pricePerNight;
    }

    public void setPricePerNight(long pricePerNight) {
        this.pricePerNight = pricePerNight;
    }
}
