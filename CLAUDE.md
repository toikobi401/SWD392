# CLAUDE.md — HotelHub (SWD392)

Quy tắc và bối cảnh dùng chung cho mọi agent nằm ở `AGENTS.md`, nạp vào đây:

@AGENTS.md

---

## Riêng cho Claude Code

- **Không viết quy tắc chung vào file này.** Quy tắc mới → `AGENTS.md` để Codex, Cursor, Copilot,
  Antigravity cùng thấy. File này chỉ giữ thứ chỉ Claude Code hiểu.
- Skill trong `.claude/skills/` là con trỏ sang `.agents/skills/` — đọc file đích rồi làm theo. Năm skill
  ghi ở `AGENTS.md` §5 là **chưa chuyển sang dự án này** thì không dùng.
- `.claude/settings.json` hỏi trước `git commit`, `git push`, `git merge`, `git rebase` (R4) và chặn đọc
  `*.xlsx`, `.playwright-mcp/`. Đó là lớp chặn thật; quy tắc trong `AGENTS.md` chỉ là chỉ dẫn.
- Kiểm file nào đã nạp: `/context`, mục **Memory files**.
