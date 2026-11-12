package com.hms.model;

import java.util.List;

public class RoomCatalog {
    private static final List<Room> ROOMS = List.of(
            new Room("101", "Standard Single", 1, 750_000, "Available"),
            new Room("202", "Deluxe Double", 2, 1_200_000, "Available"),
            new Room("305", "Family Suite", 4, 2_400_000, "Occupied")
    );

    public List<Room> findAll() {
        return ROOMS;
    }
}