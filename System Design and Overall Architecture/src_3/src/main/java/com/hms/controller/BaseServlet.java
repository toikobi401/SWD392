package com.hms.controller;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/**
 * Shared controller flow: GET renders a JSP, POST runs one action then redirects back (Post/Redirect/Get)
 * so a browser refresh never repeats the action.
 */
public abstract class BaseServlet extends HttpServlet {

    /** Runs the posted action and returns the success message; throws IllegalArgumentException on bad input. */
    protected abstract String handle(String action, HttpServletRequest request);

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {
        request.setCharacterEncoding("UTF-8");
        HttpSession session = request.getSession();
        try {
            session.setAttribute("message", handle(request.getParameter("action"), request));
        } catch (IllegalArgumentException e) {
            session.setAttribute("error", e.getMessage());
        }
        response.sendRedirect(request.getRequestURI());
    }

    protected void render(HttpServletRequest request, HttpServletResponse response, String view)
            throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        if (session != null) {
            for (String key : new String[]{"message", "error"}) {
                request.setAttribute(key, session.getAttribute(key));
                session.removeAttribute(key);
            }
        }
        request.getRequestDispatcher("/WEB-INF/views/" + view + ".jsp").forward(request, response);
    }

    protected static String text(HttpServletRequest request, String name) {
        String value = request.getParameter(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Thiếu thông tin: " + name);
        }
        return value.trim();
    }

    protected static long positiveLong(HttpServletRequest request, String name) {
        try {
            long value = Long.parseLong(text(request, name));
            if (value > 0) {
                return value;
            }
        } catch (NumberFormatException ignored) {
            // reported below with a readable message
        }
        throw new IllegalArgumentException("Giá trị phải là số dương: " + name);
    }

    protected static int positiveInt(HttpServletRequest request, String name) {
        long value = positiveLong(request, name);
        if (value > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Giá trị quá lớn: " + name);
        }
        return (int) value;
    }

    protected static LocalDate date(HttpServletRequest request, String name) {
        try {
            return LocalDate.parse(text(request, name));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Ngày không hợp lệ: " + name);
        }
    }

    protected static IllegalArgumentException unknownAction(String action) {
        return new IllegalArgumentException("Hành động không hợp lệ: " + action);
    }
}
