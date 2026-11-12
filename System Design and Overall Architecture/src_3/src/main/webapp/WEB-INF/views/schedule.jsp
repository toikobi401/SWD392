<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<c:set var="pageTitle" value="Quản lý lịch làm việc" />
<c:set var="url" value="${pageContext.request.contextPath}/manager/schedule" />
<%@ include file="common/header.jspf" %>

<section>
    <h2>Lịch làm việc (Manage Work Schedule)</h2>
    <form class="inline" method="post" action="${url}">
        <input type="hidden" name="action" value="addShift">
        <select name="employeeId" required>
            <c:forEach var="e" items="${employees}"><option value="${e.id}"><c:out value="${e.name}" /></option></c:forEach>
        </select>
        <input type="date" name="date" required>
        <select name="shiftName">
            <c:forEach var="s" items="${shiftNames}"><option><c:out value="${s}" /></option></c:forEach>
        </select>
        <button>Xếp ca</button>
    </form>
    <table>
        <thead><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th></tr></thead>
        <tbody>
        <c:forEach var="s" items="${shifts}">
            <tr>
                <td>${s.date}</td>
                <td><c:out value="${s.shiftName}" /></td>
                <td><c:out value="${employeesById[s.employeeId].name}" /></td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<section>
    <h2>Yêu cầu của nhân viên (Leave / Shift Swap / Attendance Correction)</h2>
    <table>
        <thead><tr><th>#</th><th>Loại</th><th>Nhân viên</th><th>Ngày</th><th>Nội dung</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
        <c:forEach var="r" items="${requests}">
            <tr>
                <td>${r.id}</td>
                <td>${r.type.label}</td>
                <td><c:out value="${employeesById[r.employeeId].name}" /></td>
                <td>${r.date}</td>
                <td><c:out value="${r.detail}" /></td>
                <td class="${r.status}">${r.status}</td>
                <td>
                    <c:if test="${r.status == 'PENDING'}">
                        <form class="inline" method="post" action="${url}">
                            <input type="hidden" name="requestId" value="${r.id}">
                            <button name="action" value="approveRequest">Duyệt</button>
                            <button name="action" value="rejectRequest">Từ chối</button>
                        </form>
                    </c:if>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<section>
    <h2>Duyệt bảng lương (Approve Payroll)</h2>
    <p class="muted">Bảng lương chỉ được duyệt khi nhân viên không còn yêu cầu sửa chấm công đang chờ.</p>
    <table>
        <thead><tr><th>#</th><th>Kỳ</th><th>Nhân viên</th><th>Tổng lương</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
        <c:forEach var="p" items="${payrolls}">
            <tr>
                <td>${p.id}</td>
                <td>${p.period}</td>
                <td><c:out value="${employeesById[p.employeeId].name}" /></td>
                <td><fmt:formatNumber value="${p.amount}" groupingUsed="true" /> đ</td>
                <td class="${p.status}">${p.status}</td>
                <td>
                    <c:if test="${p.status == 'PENDING'}">
                        <form class="inline" method="post" action="${url}">
                            <input type="hidden" name="action" value="approvePayroll">
                            <input type="hidden" name="payrollId" value="${p.id}">
                            <button>Duyệt</button>
                        </form>
                    </c:if>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<%@ include file="common/footer.jspf" %>
