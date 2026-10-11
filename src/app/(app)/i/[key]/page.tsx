import { IssueDetail } from "@/components/issue-detail";

export default async function IssuePage({ params }: { params: Promise<{ key: string }> }) {
  return (
    <main className="mx-auto max-w-6xl">
      <IssueDetail issueKey={(await params).key.toUpperCase()} />
    </main>
  );
}
