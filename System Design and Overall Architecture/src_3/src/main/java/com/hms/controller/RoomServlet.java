package com.hms.controller;

import com.hms.dao.RoomDAO;
import com.hms.model.Room;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

/**
 * Manage Room Inventory (include) Manage Room Type / Pricing,
 * extended by Manage Hotel Services.
 */
@WebServlet("/manager/rooms")
public class RoomServlet extends BaseServlet {
    private final RoomDAO roomDAO = RoomDAO.INSTANCE;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        request.setAttribute("rooms", roomDAO.findAllRooms());
        request.setAttribute("roomStatuses", Room.STATUSES);
        request.setAttribute("roomTypes", roomDAO.findAllRoomTypes());
        request.setAttribute("roomTypesById", roomDAO.findAllRoomTypesById());
        request.setAttribute("services", roomDAO.findAllServices());
        render(request, response, "rooms");
    }

    @Override
    protected String handle(String action, HttpServletRequest request) {
        switch (String.valueOf(action)) {
            case "addRoom": {
                String roomNumber = text(request, "roomNumber");
                roomDAO.addRoom(roomNumber, positiveInt(request, "roomTypeId"));
                return "Đã thêm phòng " + roomNumber;
            }
            case "updateRoomStatus": {
                String roomNumber = text(request, "roomNumber");
                roomDAO.updateRoomStatus(roomNumber, text(request, "status"));
                return "Đã cập nhật trạng thái phòng " + roomNumber;
            }
            case "addRoomType": {
                String name = text(request, "name");
                roomDAO.addRoomType(name, positiveInt(request, "capacity"), positiveLong(request, "price"));
                return "Đã thêm loại phòng " + name;
            }
            case "updatePrice": {
                roomDAO.updateRoomTypePrice(positiveInt(request, "roomTypeId"), positiveLong(request, "price"));
                return "Đã cập nhật giá loại phòng";
            }
            case "addService": {
                String name = text(request, "name");
                roomDAO.addService(name, positiveLong(request, "price"));
                return "Đã thêm dịch vụ " + name;
            }
            case "deleteService": {
                roomDAO.deleteService(positiveInt(request, "serviceId"));
                return "Đã xóa dịch vụ";
            }
            default:
                throw unknownAction(action);
        }
    }
}
