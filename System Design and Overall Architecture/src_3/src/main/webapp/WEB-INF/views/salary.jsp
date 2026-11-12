<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<c:set var="pageTitle" value="Quản lý lương" />
<c:set var="url" value="${pageContext.request.contextPath}/manager/salary" />
<%@ include file="common/header.jspf" %>

<section>
    <h2>Cấu trúc lương (Manage Salary Structure)</h2>
    <table>
        <thead><tr><th>Mã</th><th>Vị trí</th><th>Khung lương (đ)</th></tr></thead>
        <tbody>
        <c:forEach var="g" items="${grades}">
            <tr>
                <td><c:out value="${g.code}" /></td>
                <td><c:out value="${g.position}" /></td>
                <td>
                    <form class="inline" method="post" action="${url}">
                        <input type="hidden" name="action" value="updateGrade">
                        <input type="hidden" name="code" value="${g.code}">
                        <input type="number" name="minSalary" min="1" value="${g.minSalary}" required> –
                        <input type="number" name="maxSalary" min="1" value="${g.maxSalary}" required>
                        <button>Lưu</button>
                    </form>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<section>
    <h2>Điều chỉnh lương nhân viên (Adjust Employee Salary + View Employee Performance)</h2>
    <table>
        <thead><tr><th>Nhân viên</th><th>Vị trí</th><th>Khung</th><th>Hiệu suất</th><th>Lương cơ bản</th><th>Lương mới</th></tr></thead>
        <tbody>
        <c:forEach var="e" items="${employees}">
            <tr>
                <td><c:out value="${e.name}" /></td>
                <td><c:out value="${e.position}" /></td>
                <td><c:out value="${e.gradeCode}" /></td>
                <td><fmt:formatNumber value="${e.performanceScore}" minFractionDigits="1" /> / 5</td>
                <td><fmt:formatNumber value="${e.baseSalary}" groupingUsed="true" /> đ</td>
                <td>
                    <form class="inline" method="post" action="${url}">
                        <input type="hidden" name="action" value="adjustSalary">
                        <input type="hidden" name="employeeId" value="${e.id}">
                        <input type="number" name="newSalary" min="1" required>
                        <button>Điều chỉnh</button>
                    </form>
                </td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<section>
    <h2>Thưởng / phụ cấp (Manage Bonus / Allowance)</h2>
    <form class="inline" method="post" action="${url}">
        <input type="hidden" name="action" value="addAllowance">
        <select name="employeeId" required>
            <c:forEach var="e" items="${employees}"><option value="${e.id}"><c:out value="${e.name}" /></option></c:forEach>
        </select>
        <select name="type">
            <option value="BONUS">Thưởng</option>
            <option value="ALLOWANCE">Phụ cấp</option>
        </select>
        <input type="number" name="amount" min="1" placeholder="Số tiền" required>
        <input type="text" name="reason" placeholder="Lý do" required>
        <button>Thêm</button>
    </form>
    <table>
        <thead><tr><th>#</th><th>Nhân viên</th><th>Loại</th><th>Số tiền</th><th>Lý do</th></tr></thead>
        <tbody>
        <c:forEach var="a" items="${allowances}">
            <tr>
                <td>${a.id}</td>
                <td><c:out value="${employeesById[a.employeeId].name}" /></td>
                <td>${a.type == 'BONUS' ? 'Thưởng' : 'Phụ cấp'}</td>
                <td><fmt:formatNumber value="${a.amount}" groupingUsed="true" /> đ</td>
                <td><c:out value="${a.reason}" /></td>
            </tr>
        </c:forEach>
        </tbody>
    </table>
</section>

<%@ include file="common/footer.jspf" %>
