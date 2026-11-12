package com.hms.model;

public class HotelService {
    private final int id;
    private final String name;
    private final long price;

    public HotelService(int id, String name, long price) {
        this.id = id;
        this.name = name;
        this.price = price;
    }

    public int getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public long getPrice() {
        return price;
    }
}
