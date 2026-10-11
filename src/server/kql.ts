import { and, asc, eq, ilike, inArray, isNull, not, or, sql, type SQL } from "drizzle-orm";
import { type KqlField, type KqlNode, type KqlQuery, type KqlValue, KqlError, parseKql, parseRelativeDate } from "@/lib/kql";
import { issue, issueLabel, label, project, release, sprint, user, workflowStatus } from "./db/schema";

/**
 * Compiles KQL into SQL against `issue ⋈ project ⋈ workflow_status`. Every value is bound as a
 * parameter; only column names are ever spliced in.
 */

const PRIORITY_RANK = sql`(case ${issue.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end)`;
const PRIORITY_VALUE: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
const esc = (s: string) => s.replace(/[%_\\]/g, "\\$&");

type Ctx = { meId: string; now: Date };

function str(v: KqlValue, field: string): string {
  if (v.kind === "fn") throw new KqlError(`${v.name}() can't be used with ${field}`, 0);
  return String(v.v);
}

function dateOf(v: KqlValue, ctx: Ctx): Date {
  if (v.kind === "fn") {
    const d = new Date(ctx.now);
    switch (v.name) {
      case "now":
        return d;
      case "startofday":
        d.setHours(0, 0, 0, 0);
        return d;
      case "endofday":
        d.setHours(23, 59, 59, 999);
        return d;
      case "startofweek":
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        d.setHours(0, 0, 0, 0);
        return d;
      case "endofweek":
        d.setDate(d.getDate() + (6 - ((d.getDay() + 6) % 7)));
        d.setHours(23, 59, 59, 999);
        return d;
      case "startofmonth":
        return new Date(d.getFullYear(), d.getMonth(), 1);
      case "endofmonth":
        return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    throw new KqlError(`Unknown date function ${v.name}()`, 0);
  }
  const d = parseRelativeDate(String(v.v), ctx.now);
  if (!d) throw new KqlError(`"${v.v}" isn't a date. Use 2026-01-31, 7d, -2w or startOfWeek()`, 0);
  return d;
}

function userMatch(col: typeof issue.assigneeId | typeof issue.reporterId, v: KqlValue, ctx: Ctx): SQL {
  if (v.kind === "fn") {
    if (v.name === "me" || v.name === "currentuser") return eq(col, ctx.meId);
    throw new KqlError(`Unknown function ${v.name}()`, 0);
  }
  const s = String(v.v).toLowerCase();
  if (s === "me") return eq(col, ctx.meId);
  return inArray(
    col,
    sql`(select ${user.id} from ${user} where lower(${user.name}) = ${s} or lower(${user.email}) = ${s} or ${user.id} = ${String(v.v)} or lower(split_part(${user.email}, '@', 1)) = ${s})`,
  );
}

function compare(colSql: SQL | typeof issue.createdAt, op: string, value: unknown): SQL {
  switch (op) {
    case "=":
      return sql`${colSql} = ${value}`;
    case "!=":
      return sql`${colSql} <> ${value}`;
    case ">":
      return sql`${colSql} > ${value}`;
    case ">=":
      return sql`${colSql} >= ${value}`;
    case "<":
      return sql`${colSql} < ${value}`;
    case "<=":
      return sql`${colSql} <= ${value}`;
  }
  throw new KqlError(`Operator ${op} doesn't work here`, 0);
}

/** Single-value predicate for a field (used for =, and expanded for in/not in). */
function eqPred(field: KqlField, v: KqlValue, ctx: Ctx): SQL {
  const s = () => str(v, field).toLowerCase();
  switch (field) {
    case "project":
      return sql`lower(${project.key}) = ${s()}`;
    case "key": {
      const m = /^([a-z][a-z0-9]*)-(\d+)$/i.exec(str(v, field));
      if (!m) throw new KqlError(`"${str(v, field)}" isn't an issue key like KHR-12`, 0);
      return and(sql`lower(${project.key}) = ${m[1].toLowerCase()}`, eq(issue.number, Number(m[2])))!;
    }
    case "status":
      return sql`lower(${workflowStatus.name}) = ${s()}`;
    case "category":
      return eq(workflowStatus.category, s().replace(/[\s-]+/g, "_") as "todo");
    case "type":
      return eq(issue.type, s() as "task");
    case "priority":
      return eq(issue.priority, s() as "none");
    case "assignee":
      return userMatch(issue.assigneeId, v, ctx);
    case "reporter":
      return userMatch(issue.reporterId, v, ctx);
    case "label":
      return sql`exists (select 1 from ${issueLabel} il join ${label} l on l.id = il.label_id where il.issue_id = ${issue.id} and lower(l.name) = ${s()})`;
    case "sprint":
      if (v.kind === "fn") {
        const state = { opensprints: "active", futuresprints: "planned", closedsprints: "closed" }[v.name];
        if (!state) throw new KqlError(`Unknown function ${v.name}()`, 0);
        return inArray(issue.sprintId, sql`(select ${sprint.id} from ${sprint} where ${sprint.state} = ${state})`);
      }
      return inArray(issue.sprintId, sql`(select ${sprint.id} from ${sprint} where lower(${sprint.name}) = ${s()})`);
    case "release":
      return inArray(issue.releaseId, sql`(select ${release.id} from ${release} where lower(${release.name}) = ${s()})`);
    case "parent": {
      const m = /^([a-z][a-z0-9]*)-(\d+)$/i.exec(str(v, field));
      if (!m) throw new KqlError("parent takes an issue key like KHR-1", 0);
      return inArray(
        issue.parentId,
        sql`(select p.id from ${issue} p join ${project} pp on pp.id = p.project_id where lower(pp.key) = ${m[1].toLowerCase()} and p.number = ${Number(m[2])})`,
      );
    }
    case "triage":
      return eq(issue.triage, ["true", "yes", "1"].includes(s()));
    case "estimate":
      return eq(issue.estimate, Number(str(v, field)));
    case "title":
    case "text":
      return textPred(field, str(v, field));
    case "created":
    case "updated":
    case "due":
    case "resolved":
      return compare(dateCol(field), "=", dateOf(v, ctx));
  }
}

function dateCol(field: "created" | "updated" | "due" | "resolved") {
  return { created: issue.createdAt, updated: issue.updatedAt, resolved: issue.resolvedAt, due: sql`${issue.dueDate}::timestamptz` }[field] as SQL;
}

function textPred(field: "title" | "text", q: string): SQL {
  if (field === "title") return ilike(issue.title, `%${esc(q)}%`);
  return or(sql`${issue.search} @@ websearch_to_tsquery('english', ${q})`, ilike(issue.title, `%${esc(q)}%`))!;
}

function emptyPred(field: KqlField): SQL {
  const col = {
    assignee: issue.assigneeId,
    sprint: issue.sprintId,
    release: issue.releaseId,
    parent: issue.parentId,
    due: issue.dueDate,
    resolved: issue.resolvedAt,
    estimate: issue.estimate,
  }[field as string];
  if (col) return isNull(col);
  if (field === "label") return sql`not exists (select 1 from ${issueLabel} il where il.issue_id = ${issue.id})`;
  if (field === "text") return sql`${issue.description} = ''`;
  throw new KqlError(`${field} is never empty`, 0);
}

function clause(n: Extract<KqlNode, { type: "clause" }>, ctx: Ctx): SQL {
  const { field, op, values } = n;
  if (op === "is empty") return emptyPred(field);
  if (op === "is not empty") return not(emptyPred(field));
  if (op === "in" || op === "not in") {
    const any = or(...values.map((v) => eqPred(field, v, ctx)))!;
    return op === "in" ? any : not(any);
  }
  const v = values[0];
  if (op === "~" || op === "!~") {
    if (!["text", "title", "assignee", "reporter", "project", "status", "label"].includes(field)) throw new KqlError(`~ doesn't work on ${field}`, 0);
    const q = str(v, field);
    const p =
      field === "text" || field === "title"
        ? textPred(field, q)
        : field === "project"
          ? or(ilike(project.name, `%${esc(q)}%`), ilike(project.key, `%${esc(q)}%`))!
          : field === "status"
            ? ilike(workflowStatus.name, `%${esc(q)}%`)
            : field === "label"
              ? sql`exists (select 1 from ${issueLabel} il join ${label} l on l.id = il.label_id where il.issue_id = ${issue.id} and l.name ilike ${`%${esc(q)}%`})`
              : inArray(field === "assignee" ? issue.assigneeId : issue.reporterId, sql`(select ${user.id} from ${user} where ${user.name} ilike ${`%${esc(q)}%`})`);
    return op === "~" ? p : not(p);
  }
  if (op === "=") return eqPred(field, v, ctx);
  if (op === "!=") {
    // JQL semantics: assignee != bob also returns unassigned issues.
    const nullable = { assignee: issue.assigneeId, sprint: issue.sprintId, release: issue.releaseId, parent: issue.parentId }[field as string];
    return nullable ? or(isNull(nullable), not(eqPred(field, v, ctx)))! : not(eqPred(field, v, ctx));
  }
  // Ordered comparisons
  if (field === "priority") {
    const rank = PRIORITY_VALUE[str(v, field).toLowerCase()];
    if (rank === undefined) throw new KqlError(`Unknown priority "${str(v, field)}"`, 0);
    return compare(PRIORITY_RANK, op, rank);
  }
  if (field === "estimate") return compare(sql`${issue.estimate}`, op, Number(str(v, field)));
  if (field === "created" || field === "updated" || field === "due" || field === "resolved") {
    const d = dateOf(v, ctx);
    return field === "due" ? compare(sql`${issue.dueDate}`, op, d.toISOString().slice(0, 10)) : compare(dateCol(field), op, d);
  }
  throw new KqlError(`${op} doesn't work on ${field}`, 0);
}

function node(n: KqlNode, ctx: Ctx): SQL {
  switch (n.type) {
    case "and":
      return and(node(n.left, ctx), node(n.right, ctx))!;
    case "or":
      return or(node(n.left, ctx), node(n.right, ctx))!;
    case "not":
      return not(node(n.expr, ctx));
    case "clause":
      return clause(n, ctx);
  }
}

const ORDER_COL: Partial<Record<KqlField, SQL>> = {
  created: sql`${issue.createdAt}`,
  updated: sql`${issue.updatedAt}`,
  resolved: sql`${issue.resolvedAt}`,
  due: sql`${issue.dueDate}`,
  estimate: sql`${issue.estimate}`,
  priority: PRIORITY_RANK,
  key: sql`${issue.number}`,
  status: sql`${workflowStatus.position}`,
  project: sql`${project.key}`,
  title: sql`${issue.title}`,
};

export function compileKql(q: KqlQuery | string, ctx: Ctx) {
  const query = typeof q === "string" ? parseKql(q) : q;
  const where = query.where ? node(query.where, ctx) : undefined;
  const orderBy = query.orderBy.map((o) => {
    const col = ORDER_COL[o.field];
    if (!col) throw new KqlError(`Can't order by ${o.field}`, 0);
    return o.dir === "desc" ? sql`${col} desc nulls last` : sql`${col} asc nulls last`;
  });
  return { where, orderBy: orderBy.length ? orderBy : [asc(issue.rank)] };
}

