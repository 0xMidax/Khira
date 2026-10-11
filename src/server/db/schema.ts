import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
// Fractional-index ranks must sort bytewise, not by locale.
const rankText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

// ---------- Auth (Better Auth core tables; `role` is our additional field) ----------

export const roleEnum = pgEnum("role", ["admin", "member", "guest"]);

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  role: roleEnum().notNull().default("member"),
  createdAt: now(),
  updatedAt: now(),
});

export const session = pgTable("session", {
  id: text().primaryKey(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  token: text().notNull().unique(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: now(),
  updatedAt: now(),
});

export const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: now(),
  updatedAt: now(),
});

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: now(),
  updatedAt: now(),
});

// ---------- Projects & workflow ----------

export const project = pgTable("project", {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  leadId: text().references(() => user.id, { onDelete: "set null" }),
  issueCounter: integer().notNull().default(0),
  settings: jsonb().$type<ProjectSettings>().notNull().default({}),
  archivedAt: timestamp({ withTimezone: true }),
  createdAt: now(),
});

export type SlaTargets = Partial<Record<"urgent" | "high" | "medium" | "low", { responseHours: number; resolveHours: number }>>;
export type ProjectSettings = {
  /** Block moving to a done status while subtasks are open. */
  /** scrum = sprints + backlog; kanban = one continuous board. Absent means scrum. */
  method?: "scrum" | "kanban";
  requireSubtasksDone?: boolean;
  /** Days without status change before an issue counts as stale. 0/undefined = off. */
  staleDays?: number;
  sla?: SlaTargets;
  /** Status ids to move to; undefined = sensible default, null = don't move. */
  github?: { repos?: string[]; onBranchCreated?: string | null; onPrOpened?: string | null; onPrMerged?: string | null; autoAssign?: boolean };
};

export const statusCategoryEnum = pgEnum("status_category", ["todo", "in_progress", "done"]);

// Each project owns its workflow (statuses + optional transition rules). No shared workflow schemes: one small team.
export const workflowStatus = pgTable(
  "workflow_status",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    category: statusCategoryEnum().notNull(),
    position: integer().notNull(),
    color: text().notNull().default("slate"),
    wipLimit: integer(),
  },
  (t) => [index().on(t.projectId, t.position)],
);

/** If a project has no rows here, every transition is allowed. */
export const workflowTransition = pgTable(
  "workflow_transition",
  {
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    fromStatusId: uuid()
      .notNull()
      .references(() => workflowStatus.id, { onDelete: "cascade" }),
    toStatusId: uuid()
      .notNull()
      .references(() => workflowStatus.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.fromStatusId, t.toStatusId] }), index().on(t.projectId)],
);

export const sprintStateEnum = pgEnum("sprint_state", ["planned", "active", "closed"]);

export const sprint = pgTable(
  "sprint",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    goal: text(),
    startDate: date(),
    endDate: date(),
    state: sprintStateEnum().notNull().default("planned"),
    /** Snapshot at start (for burndown) and at close (for velocity). */
    committedPoints: integer(),
    completedPoints: integer(),
    startedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index().on(t.projectId, t.state)],
);

export const release = pgTable(
  "release",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    releaseDate: date(),
    releasedAt: timestamp({ withTimezone: true }),
    notes: text(),
    /** Public read-only changelog page. */
    publicSlug: text().unique(),
    createdAt: now(),
  },
  (t) => [uniqueIndex().on(t.projectId, t.name)],
);

// ---------- Issues ----------

export const issueTypeEnum = pgEnum("issue_type", ["epic", "story", "task", "bug", "subtask"]);
export const priorityEnum = pgEnum("priority", ["none", "low", "medium", "high", "urgent"]);

export const issue = pgTable(
  "issue",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    type: issueTypeEnum().notNull().default("task"),
    title: text().notNull(),
    description: text().notNull().default(""),
    statusId: uuid()
      .notNull()
      .references(() => workflowStatus.id),
    priority: priorityEnum().notNull().default("none"),
    assigneeId: text().references(() => user.id, { onDelete: "set null" }),
    reporterId: text()
      .notNull()
      .references(() => user.id),
    parentId: uuid().references((): AnyPgColumn => issue.id, { onDelete: "set null" }),
    estimate: integer(),
    dueDate: date(),
    startDate: date(),
    rank: rankText().notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    sprintId: uuid().references(() => sprint.id, { onDelete: "set null" }),
    releaseId: uuid().references(() => release.id, { onDelete: "set null" }),
    /** Came in from email/Slack/GitHub and still needs a human to sort it. */
    triage: boolean().notNull().default(false),
    source: text().notNull().default("web"),
    firstResponseAt: timestamp({ withTimezone: true }),
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))`,
    ),
    createdAt: now(),
    updatedAt: now(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex().on(t.projectId, t.number),
    index().on(t.projectId, t.statusId, t.rank),
    index().on(t.assigneeId, t.statusId),
    index().on(t.parentId),
    index().on(t.sprintId),
    index().on(t.triage),
    index("issue_search_idx").using("gin", t.search),
  ],
);

export const label = pgTable(
  "label",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    color: text().notNull().default("slate"),
  },
  (t) => [uniqueIndex().on(t.projectId, t.name)],
);

export const issueLabel = pgTable(
  "issue_label",
  {
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    labelId: uuid()
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

export const linkTypeEnum = pgEnum("link_type", ["blocks", "relates", "duplicates", "clones"]);

export const issueLink = pgTable(
  "issue_link",
  {
    id: uuid().primaryKey().defaultRandom(),
    type: linkTypeEnum().notNull(),
    fromId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    toId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex().on(t.fromId, t.toId, t.type), index().on(t.toId)],
);

export const watcher = pgTable(
  "watcher",
  {
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.userId] })],
);

export const comment = pgTable(
  "comment",
  {
    id: uuid().primaryKey().defaultRandom(),
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    authorId: text()
      .notNull()
      .references(() => user.id),
    parentId: uuid().references((): AnyPgColumn => comment.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdAt: now(),
    editedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.issueId, t.createdAt)],
);

// ---------- Activity & notifications ----------

// Append-only history: source of truth for the history tab, notifications and (later) reports.
export const activity = pgTable(
  "activity",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: text()
      .notNull()
      .references(() => user.id),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    issueId: uuid().references(() => issue.id, { onDelete: "cascade" }),
    verb: text().notNull(), // created | updated | commented | deleted | restored | linked | worklog
    /** user | automation | github | slack | email | system — automations ignore their own activity. */
    source: text().notNull().default("user"),
    diff: jsonb().$type<Record<string, { from: unknown; to: unknown }>>(),
    createdAt: now(),
  },
  (t) => [index().on(t.issueId, t.createdAt), index().on(t.actorId, t.createdAt)],
);

export const notification = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activityId: uuid()
      .notNull()
      .references(() => activity.id, { onDelete: "cascade" }),
    reason: text().notNull(), // assigned | mentioned | watching
    readAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index().on(t.userId, t.readAt, t.createdAt)],
);

// ---------- Collaboration extras ----------

export const commentReaction = pgTable(
  "comment_reaction",
  {
    commentId: uuid()
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId, t.emoji] })],
);

export const attachment = pgTable(
  "attachment",
  {
    id: uuid().primaryKey().defaultRandom(),
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    uploaderId: text()
      .notNull()
      .references(() => user.id),
    storageKey: text().notNull().unique(),
    name: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    /** False until the client confirms the upload finished. */
    uploaded: boolean().notNull().default(false),
    createdAt: now(),
  },
  (t) => [index().on(t.issueId)],
);

export const worklog = pgTable(
  "worklog",
  {
    id: uuid().primaryKey().defaultRandom(),
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id),
    minutes: integer().notNull(),
    note: text(),
    day: date().notNull(),
    createdAt: now(),
  },
  (t) => [index().on(t.issueId), index().on(t.userId, t.day)],
);

export const customFieldTypeEnum = pgEnum("custom_field_type", ["text", "number", "select", "date"]);

export const customField = pgTable(
  "custom_field",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: customFieldTypeEnum().notNull(),
    options: jsonb().$type<string[]>(),
    position: integer().notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.projectId, t.name)],
);

export const issueCustomValue = pgTable(
  "issue_custom_value",
  {
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    fieldId: uuid()
      .notNull()
      .references(() => customField.id, { onDelete: "cascade" }),
    value: jsonb().$type<string | number>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.fieldId] })],
);

export const savedFilter = pgTable("saved_filter", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text().notNull(),
  kql: text().notNull(),
  shared: boolean().notNull().default(false),
  createdAt: now(),
});

// ---------- Retros, standups, dashboards ----------

export const retroItem = pgTable(
  "retro_item",
  {
    id: uuid().primaryKey().defaultRandom(),
    sprintId: uuid()
      .notNull()
      .references(() => sprint.id, { onDelete: "cascade" }),
    column: text().$type<"well" | "improve" | "action">().notNull(),
    body: text().notNull(),
    authorId: text()
      .notNull()
      .references(() => user.id),
    votes: jsonb().$type<string[]>().notNull().default([]),
    issueId: uuid().references(() => issue.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index().on(t.sprintId)],
);

export const standup = pgTable(
  "standup",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: date().notNull(),
    content: text().notNull(),
    postedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (t) => [uniqueIndex().on(t.userId, t.day)],
);

export const dashboard = pgTable("dashboard", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text().notNull(),
  shared: boolean().notNull().default(false),
  /** Ordered widgets: { type, title, kql?, projectId?, chart? } */
  widgets: jsonb().$type<DashboardWidget[]>().notNull().default([]),
  createdAt: now(),
});
export type DashboardWidget = {
  id: string;
  type: "count" | "list" | "byStatus" | "byAssignee" | "byPriority" | "createdVsResolved";
  title: string;
  kql: string;
};

// ---------- Automation ----------

export const automationRule = pgTable(
  "automation_rule",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    trigger: text().$type<"created" | "updated" | "commented" | "statusChanged">().notNull(),
    conditions: jsonb().$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb().$type<AutomationAction[]>().notNull(),
    enabled: boolean().notNull().default(true),
    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: now(),
  },
  (t) => [index().on(t.projectId, t.enabled)],
);
export type AutomationCondition = { field: "type" | "priority" | "statusId" | "assigneeId" | "labelId" | "title"; op: "is" | "isNot" | "contains"; value: string | null };
export type AutomationAction =
  | { type: "assign"; userId: string | null }
  | { type: "setPriority"; priority: "none" | "low" | "medium" | "high" | "urgent" }
  | { type: "setStatus"; statusId: string }
  | { type: "addLabel"; labelId: string }
  | { type: "comment"; body: string }
  | { type: "notifySlack"; text: string };

export const automationRun = pgTable(
  "automation_run",
  {
    id: uuid().primaryKey().defaultRandom(),
    ruleId: uuid()
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    issueId: uuid().references(() => issue.id, { onDelete: "set null" }),
    ok: boolean().notNull(),
    error: text(),
    createdAt: now(),
  },
  (t) => [index().on(t.ruleId, t.createdAt)],
);

export const issueTemplate = pgTable("issue_template", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  name: text().notNull(),
  /** Partial issue fields + optional checklist of subtask titles. */
  fields: jsonb().$type<TemplateFields>().notNull(),
  createdAt: now(),
});
export type TemplateFields = {
  title: string;
  description?: string;
  type?: "epic" | "story" | "task" | "bug" | "subtask";
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  assigneeId?: string | null;
  labelIds?: string[];
  subtasks?: string[];
};

export const recurringIssue = pgTable("recurring_issue", {
  id: uuid().primaryKey().defaultRandom(),
  templateId: uuid()
    .notNull()
    .references(() => issueTemplate.id, { onDelete: "cascade" }),
  /** { freq: "daily" | "weekly" | "monthly", interval, weekday?, monthDay? } */
  rule: jsonb().$type<Recurrence>().notNull(),
  nextRunAt: timestamp({ withTimezone: true }).notNull(),
  enabled: boolean().notNull().default(true),
  createdBy: text()
    .notNull()
    .references(() => user.id),
  createdAt: now(),
});
export type Recurrence = { freq: "daily" | "weekly" | "monthly"; interval: number; weekday?: number; monthDay?: number; hour?: number };

// ---------- Notifications delivery & integrations ----------

export const userSettings = pgTable("user_settings", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  email: text().$type<"instant" | "digest" | "off">().notNull().default("instant"),
  push: boolean().notNull().default(true),
  slackUserId: text(),
  githubLogin: text(),
  timezone: text().notNull().default("UTC"),
});

export const pushSubscription = pgTable("push_subscription", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  endpoint: text().notNull().unique(),
  keys: jsonb().$type<{ p256dh: string; auth: string }>().notNull(),
  createdAt: now(),
});

/** Where a project posts updates: a Slack channel (via bot token) or a Discord webhook URL (encrypted). */
export const projectChannel = pgTable("project_channel", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  kind: text().$type<"slack" | "discord">().notNull(),
  target: text().notNull(),
  events: jsonb().$type<Array<"created" | "statusChanged" | "commented" | "released">>().notNull().default(["created", "statusChanged"]),
  createdAt: now(),
});

export const githubLink = pgTable(
  "github_link",
  {
    id: uuid().primaryKey().defaultRandom(),
    issueId: uuid()
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    kind: text().$type<"pr" | "commit" | "branch">().notNull(),
    repo: text().notNull(),
    ref: text().notNull(), // PR number, commit sha or branch name
    title: text(),
    url: text().notNull(),
    state: text(), // open | closed | merged
    updatedAt: now(),
  },
  (t) => [uniqueIndex().on(t.issueId, t.kind, t.repo, t.ref)],
);

export const apiToken = pgTable("api_token", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text().notNull(),
  hash: text().notNull().unique(),
  prefix: text().notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: now(),
});

export const outgoingWebhook = pgTable("outgoing_webhook", {
  id: uuid().primaryKey().defaultRandom(),
  url: text().notNull(),
  /** Encrypted at rest; used to sign payloads (X-Khira-Signature). */
  secret: text().notNull(),
  events: jsonb().$type<string[]>().notNull().default(["*"]),
  enabled: boolean().notNull().default(true),
  createdBy: text()
    .notNull()
    .references(() => user.id),
  lastStatus: integer(),
  createdAt: now(),
});

/** Workspace-level connections set up from the Integrations page. Secrets are AES-GCM encrypted JSON. */
export const workspaceIntegration = pgTable("workspace_integration", {
  kind: text().$type<"slack" | "github" | "email">().primaryKey(),
  secrets: text().notNull(),
  /** Non-secret settings and health, e.g. { from, inboundDomain, standupChannel, lastEventAt }. */
  meta: jsonb().$type<Record<string, string | null>>().notNull().default({}),
  connectedBy: text().references(() => user.id, { onDelete: "set null" }),
  updatedAt: now(),
});
