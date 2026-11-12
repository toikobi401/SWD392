<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<c:set var="pageTitle" value="Hotel Management System - Manager" />
<%@ include file="/WEB-INF/views/common/header.jspf" %>
    <p class="muted">Chọn nhóm chức năng:</p>
    <ul>
        <li><a href="manager/salary">Quản lý cấu trúc lương</a> – điều chỉnh lương, thưởng/phụ cấp, xem hiệu suất</li>
        <li><a href="manager/schedule">Quản lý lịch làm việc</a> – duyệt nghỉ phép, đổi ca, sửa chấm công, duyệt bảng lương</li>
        <li><a href="manager/rooms">Quản lý phòng</a> – loại phòng/giá, dịch vụ khách sạn</li>
    </ul>
<%@ include file="/WEB-INF/views/common/footer.jspf" %>
