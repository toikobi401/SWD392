package com.hms.dao;

import com.hms.model.HotelService;
import com.hms.model.Room;
import com.hms.model.RoomType;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class RoomDAO {
    public static final RoomDAO INSTANCE = new RoomDAO();

    private final Map<Integer, RoomType> roomTypes = new LinkedHashMap<>();
    private final Map<String, Room> rooms = new LinkedHashMap<>();
    private final Map<Integer, HotelService> services = new LinkedHashMap<>();
    private int nextRoomTypeId = 1;
    private int nextServiceId = 1;

    public RoomDAO() {
        addRoomType("Standard Single", 1, 750_000);
        addRoomType("Deluxe Double", 2, 1_200_000);
        addRoomType("Family Suite", 4, 2_400_000);
        addRoom("101", 1);
        addRoom("202", 2);
        addRoom("305", 3);
        addService("Giặt ủi", 50_000);
        addService("Ăn sáng", 150_000);
        addService("Đưa đón sân bay", 300_000);
    }

    public synchronized List<RoomType> findAllRoomTypes() {
        return List.copyOf(roomTypes.values());
    }

    public synchronized Map<Integer, RoomType> findAllRoomTypesById() {
        return Map.copyOf(roomTypes);
    }

    public synchronized void addRoomType(String name, int capacity, long pricePerNight) {
        int id = nextRoomTypeId++;
        roomTypes.put(id, new RoomType(id, name, capacity, pricePerNight));
    }

    public synchronized void updateRoomTypePrice(int roomTypeId, long pricePerNight) {
        RoomType roomType = roomTypes.get(roomTypeId);
        if (roomType == null) {
            throw new IllegalArgumentException("Không tìm thấy loại phòng #" + roomTypeId);
        }
        roomType.setPricePerNight(pricePerNight);
    }

    public synchronized List<Room> findAllRooms() {
        return List.copyOf(rooms.values());
    }

    public synchronized void addRoom(String roomNumber, int roomTypeId) {
        if (rooms.containsKey(roomNumber)) {
            throw new IllegalArgumentException("Phòng " + roomNumber + " đã tồn tại");
        }
        if (!roomTypes.containsKey(roomTypeId)) {
            throw new IllegalArgumentException("Không tìm thấy loại phòng #" + roomTypeId);
        }
        rooms.put(roomNumber, new Room(roomNumber, roomTypeId, "Available"));
    }

    public synchronized void updateRoomStatus(String roomNumber, String status) {
        Room room = rooms.get(roomNumber);
        if (room == null) {
            throw new IllegalArgumentException("Không tìm thấy phòng " + roomNumber);
        }
        if (!Room.STATUSES.contains(status)) {
            throw new IllegalArgumentException("Trạng thái không hợp lệ: " + status);
        }
        room.setStatus(status);
    }

    public synchronized List<HotelService> findAllServices() {
        return List.copyOf(services.values());
    }

    public synchronized void addService(String name, long price) {
        int id = nextServiceId++;
        services.put(id, new HotelService(id, name, price));
    }

    public synchronized void deleteService(int serviceId) {
        if (services.remove(serviceId) == null) {
            throw new IllegalArgumentException("Không tìm thấy dịch vụ #" + serviceId);
        }
    }
}
