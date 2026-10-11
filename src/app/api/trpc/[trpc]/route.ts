import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/root";
import { reportError } from "@/server/observability";
import { createContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ headers: req.headers }),
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") void reportError(error, { path });
    },
  });

export { handler as GET, handler as POST };
