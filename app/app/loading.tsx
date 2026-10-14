export default function AppLoading() {
  return (
    <div aria-busy="true" className="app-page app-page--loading" role="status">
      <span className="sr-only">Loading workspace</span>
      <div className="app-loading-heading" />
      <div className="app-loading-panel">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
