<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Danh sách phòng</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 2rem auto; max-width: 900px; padding: 0 1rem; color: #202124; }
        h1 { margin-bottom: 0.35rem; }
        p { color: #5f6368; }
        table { border-collapse: collapse; margin-top: 1.5rem; width: 100%; }
        th, td { border-bottom: 1px solid #dadce0; padding: 0.8rem; text-align: left; }
        th { background: #f1f3f4; }
        .available { color: #137333; }
        .occupied { color: #b06000; }
    </style>
</head>
<body>
    <h1>Danh sách phòng</h1>
    <p>Dữ liệu mẫu được lưu tạm trong bộ nhớ.</p>

    <c:choose>
        <c:when test="${not empty rooms}">
            <table>
                <thead>
                    <tr>
                        <th>Số phòng</th>
                        <th>Loại phòng</th>
                        <th>Sức chứa</th>
                        <th>Giá mỗi đêm</th>
                        <th>Trạng thái</th>
                    </tr>
                </thead>
                <tbody>
                    <c:forEach var="room" items="${rooms}">
                        <tr>
                            <td><c:out value="${room.roomNumber}" /></td>
                            <td><c:out value="${room.roomType}" /></td>
                            <td><c:out value="${room.capacity}" /> khách</td>
                            <td><fmt:formatNumber value="${room.pricePerNight}" type="number" groupingUsed="true" /> đ</td>
                            <td class="${room.status == 'Available' ? 'available' : 'occupied'}">
                                <c:out value="${room.status}" />
                            </td>
                        </tr>
                    </c:forEach>
                </tbody>
            </table>
        </c:when>
        <c:otherwise>
            <p>Hiện chưa có phòng nào.</p>
        </c:otherwise>
    </c:choose>
</body>
</html>