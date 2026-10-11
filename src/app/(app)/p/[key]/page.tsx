import { ProjectView } from "./view";

export default async function ProjectPage({ params }: { params: Promise<{ key: string }> }) {
  return <ProjectView projectKey={(await params).key.toUpperCase()} />;
}
