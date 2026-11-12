<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<c:set var="pageTitle" value="Quản lý phòng" />
<c:set var="url" value="${pageContext.request.contextPath}/manager/rooms" />
<%@ include file="common/header.jspf" %>

<section>
    <h2>Danh sách phòng (Manage Room Inventory)</h2>
    <form class="inline" method="post" action="${url}">
        <input type="hidden" name="action" value="addRoom">
        <input type="text" name="roomNumber" placeholder="Số phòng" required>
        <select name="roomTypeId">
            <c:forEach var="t" items="${roomTypes}"><option value="${t.id}"><c:out value="${t.name}" /></option></c:forEach>
        </select>
        <button>Thêm phòng</button>
    </form>
    <table>
        <thead><tr><th>Số phòng</th><th>Loại phòng</th><th>Giá mỗi đêm</th><th>Trạng thái</th></tr></thead>
        <tbody>
        <c:forEach var="room" items="${rooms}">
            <c:set var="type" value="${roomTypesById[room.roomTypeId]}" />
            <tr>
                <td><c:out value="${room.roomNumber}" /></td>
                <td><c:out value="${type.name}" /></td>
                <td><fmt:formatNumber value="${type.pricePerNight}" groupingUsed="true" /> đ</td>
                <td>
                    <form class="inline" method="post" action="${url}">
                        <input type="hidden" name="action" value="updateRoomStatus">
                        <input type="hidden" name="roomNumber" value="<c:out value='${room.roomNumber}' />">
                        <select name="status">
                            <c:forEach var="st" items="${roomStatuses}">
                                <option ${st == room.status ? 'selected' : ''}>${st}</option>
                            </c:forEach>
                        </select>
                        <button>Cập nhật</button>
                    </form>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<section>
    <h2>Loại phòng &amp; giá (Manage Room Type / Pricing)</h2>
    <form class="inline" method="post" action="${url}">
        <input type="hidden" name="action" value="addRoomType">
        <input type="text" name="name" placeholder="Tên loại phòng" required>
        <input type="number" name="capacity" min="1" placeholder="Sức chứa" required>
        <input type="number" name="price" min="1" placeholder="Giá mỗi đêm" required>
        <button>Thêm loại phòng</button>
    </form>
    <table>
        <thead><tr><th>#</th><th>Tên</th><th>Sức chứa</th><th>Giá mỗi đêm (đ)</th></tr></thead>
        <tbody>
        <c:forEach var="t" items="${roomTypes}">
            <tr>
                <td>${t.id}</td>
                <td><c:out value="${t.name}" /></td>
                <td>${t.capacity} khách</td>
                <td>
                    <form class="inline" method="post" action="${url}">
                        <input type="hidden" name="action" value="updatePrice">
                        <input type="hidden" name="roomTypeId" value="${t.id}">
                        <input type="number" name="price" min="1" value="${t.pricePerNight}" required>
                        <button>Lưu giá</button>
                    </form>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<section>
    <h2>Dịch vụ khách sạn (Manage Hotel Services)</h2>
    <form class="inline" method="post" action="${url}">
        <input type="hidden" name="action" value="addService">
        <input type="text" name="name" placeholder="Tên dịch vụ" required>
        <input type="number" name="price" min="1" placeholder="Giá" required>
        <button>Thêm dịch vụ</button>
    </form>
    <table>
        <thead><tr><th>#</th><th>Dịch vụ</th><th>Giá</th><th></th></tr></thead>
        <tbody>
        <c:forEach var="s" items="${services}">
            <tr>
                <td>${s.id}</td>
                <td><c:out value="${s.name}" /></td>
                <td><fmt:formatNumber value="${s.price}" groupingUsed="true" /> đ</td>
                <td>
                    <form class="inline" method="post" action="${url}">
                        <input type="hidden" name="action" value="deleteService">
                        <input type="hidden" name="serviceId" value="${s.id}">
                        <button>Xóa</button>
                    </form>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<%@ include file="common/footer.jspf" %>
