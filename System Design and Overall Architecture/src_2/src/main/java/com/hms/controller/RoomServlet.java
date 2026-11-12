package com.hms.controller;

import com.hms.model.RoomCatalog;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

@WebServlet("/rooms")
public class RoomServlet extends HttpServlet {
    private final RoomCatalog roomCatalog = new RoomCatalog();

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        request.setAttribute("rooms", roomCatalog.findAll());
        request.getRequestDispatcher("/WEB-INF/views/rooms.jsp").forward(request, response);
    }
}