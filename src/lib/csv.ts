/** RFC 4180 CSV: quoted fields, escaped quotes (""), CRLF/LF, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const needsQuote = /[",\r\n]/;
// Leading = + - @ would run as formulas in spreadsheet apps (CSV injection).
const escapeCell = (v: unknown) => {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]) {
  return [header, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

/** Maps common JIRA export headers (and our own) to fields. */
export function mapHeader(h: string): string | null {
  const k = h.trim().toLowerCase();
  if (["summary", "title"].includes(k)) return "title";
  if (k === "description") return "description";
  if (["issue type", "type"].includes(k)) return "type";
  if (k === "priority") return "priority";
  if (k === "status") return "status";
  if (["assignee", "assignee email"].includes(k)) return "assignee";
  if (["due date", "due"].includes(k)) return "dueDate";
  if (["labels", "label"].includes(k)) return "labels";
  if (["story points", "custom field (story points)", "estimate", "story point estimate", "custom field (story point estimate)"].includes(k)) return "estimate";
  return null;
}

export function mapPriority(v: string) {
  const k = v.trim().toLowerCase();
  if (["highest", "blocker", "critical", "urgent"].includes(k)) return "urgent" as const;
  if (["high", "major"].includes(k)) return "high" as const;
  if (["medium", "normal"].includes(k)) return "medium" as const;
  if (["low", "lowest", "minor", "trivial"].includes(k)) return "low" as const;
  return "none" as const;
}

export function mapType(v: string) {
  const k = v.trim().toLowerCase().replace(/[\s-]/g, "");
  if (k === "bug") return "bug" as const;
  if (k === "story" || k === "userstory") return "story" as const;
  if (k === "epic") return "epic" as const;
  if (k === "subtask") return "subtask" as const;
  return "task" as const;
}

/** JIRA dates come as "2026-03-14", "14/Mar/26" or "14/Mar/26 3:04 PM". */
export function parseLooseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})/.exec(s);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
    if (mon < 0) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
