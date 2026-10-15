import { LoaderCircle } from "lucide-react";

export default function AppLoading() {
  return (
    <div aria-busy="true" className="app-page app-page--loading" role="status">
      <span className="sr-only">Loading workspace</span>
      <div className="app-loading-heading" />
      <div className="app-loading-panel">
        <LoaderCircle aria-hidden="true" className="app-loading-spinner" size={31} strokeWidth={1.7} />
        <p>Opening your workspace</p>
      </div>
    </div>
  );
}
