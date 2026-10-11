import { automationRouter, integrationRouter } from "./routers/admin";
import { aiRouter } from "./routers/ai";
import { dataRouter } from "./routers/data";
import { dashboardRouter, retroRouter, standupRouter } from "./routers/team";
import { searchRouter, sprintRouter, workflowRouter } from "./routers/agile";
import { issueExtrasRouter, settingsRouter } from "./routers/extras";
import { issueRouter } from "./routers/issue";
import { releaseRouter } from "./routers/release";
import { reportsRouter, timeRouter } from "./routers/reports";
import { commentRouter, inviteRouter, notificationRouter, userRouter } from "./routers/misc";
import { projectRouter } from "./routers/project";
import { createCallerFactory, router } from "./trpc";

export const appRouter = router({
  project: projectRouter,
  issue: issueRouter,
  comment: commentRouter,
  notification: notificationRouter,
  user: userRouter,
  invite: inviteRouter,
  search: searchRouter,
  sprint: sprintRouter,
  workflow: workflowRouter,
  reports: reportsRouter,
  time: timeRouter,
  extras: issueExtrasRouter,
  settings: settingsRouter,
  release: releaseRouter,
  integration: integrationRouter,
  automation: automationRouter,
  ai: aiRouter,
  data: dataRouter,
  standup: standupRouter,
  dashboard: dashboardRouter,
  retro: retroRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
