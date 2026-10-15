import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

export default function AppLoading() {
  return (
    <div className="app-page">
      <LoadingSkeleton kind="page" label="Opening your workspace…" />
    </div>
  );
}
