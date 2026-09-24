/* __BUILD_INFO__ is injected by vite.config.mjs from Git at build time. */
const BUILD = typeof __BUILD_INFO__ === "undefined" ? { label: "" } : __BUILD_INFO__;

export function VersionBadge() {
  if (!BUILD.label) return null;
  const title = `Built ${BUILD.date}${BUILD.fullSha ? ` · ${BUILD.fullSha}` : ""}`;
  return (
    <div className="version-badge" title={title} data-build-sha={BUILD.fullSha || undefined}>
      {BUILD.label}
    </div>
  );
}
