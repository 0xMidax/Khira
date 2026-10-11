import { z } from "zod";

export const ISSUE_TYPES = ["epic", "story", "task", "bug", "subtask"] as const;
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export const ROLES = ["admin", "member", "guest"] as const;

const id = z.string().uuid();
const userId = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const projectCreate = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2–10 letters/digits, starting with a letter"),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  method: z.enum(["scrum", "kanban"]).default("scrum"),
});

export const issueCreate = z.object({
  projectId: id,
  title: z.string().trim().min(1).max(255),
  description: z.string().max(50_000).optional(),
  type: z.enum(ISSUE_TYPES).default("task"),
  priority: z.enum(PRIORITIES).default("none"),
  statusId: id.optional(),
  assigneeId: userId.nullish(),
  parentId: id.nullish(),
  estimate: z.number().int().min(0).max(1000).nullish(),
  dueDate: day.nullish(),
  startDate: day.nullish(),
  labelIds: z.array(id).max(20).optional(),
  sprintId: id.nullish(),
  releaseId: id.nullish(),
  triage: z.boolean().optional(),
});
export type IssueCreateInput = z.infer<typeof issueCreate>;

export const issueUpdate = z.object({
  id,
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(50_000).optional(),
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  statusId: id.optional(),
  assigneeId: userId.nullable().optional(),
  parentId: id.nullable().optional(),
  estimate: z.number().int().min(0).max(1000).nullable().optional(),
  dueDate: day.nullable().optional(),
  startDate: day.nullable().optional(),
  labelIds: z.array(id).max(20).optional(),
  sprintId: id.nullable().optional(),
  releaseId: id.nullable().optional(),
  triage: z.boolean().optional(),
  rank: z.string().max(64).optional(),
});
export type IssueUpdateInput = z.infer<typeof issueUpdate>;

export const issueMove = z.object({
  id,
  statusId: id.optional(),
  sprintId: id.nullable().optional(),
  afterId: id.nullable(),
  beforeId: id.nullable(),
});

export const issueListFilter = z.object({
  projectId: id,
  assigneeId: userId.nullable().optional(), // null = unassigned
  type: z.enum(ISSUE_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  labelId: id.optional(),
  sprintId: id.optional(),
  /** Kanban: hide issues resolved before this date (old Done cards). */
  resolvedSince: day.optional(),
  q: z.string().max(200).optional(),
  includeDeleted: z.boolean().optional(),
});

export const commentCreate = z.object({ issueId: id, body: z.string().trim().min(1).max(20_000), parentId: id.nullish() });
export const commentEdit = z.object({ id, body: z.string().trim().min(1).max(20_000) });

/** "KHR-12" → { key: "KHR", number: 12 } */
export const issueKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/)
  .transform((s) => {
    const i = s.lastIndexOf("-");
    return { key: s.slice(0, i).toUpperCase(), number: Number(s.slice(i + 1)) };
  });
