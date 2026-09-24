import { execFileSync } from "node:child_process";

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function first(...values) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

// Resolved once at build time; only public build metadata reaches the bundle.
export function resolveBuildInfo(env = process.env) {
  const date = first(env.APP_BUILD_DATE, git(["log", "-1", "--format=%cI"]), new Date().toISOString());
  const count = first(env.APP_BUILD_COUNT, env.GITHUB_RUN_NUMBER, git(["rev-list", "--count", "HEAD"]));
  const fullSha = first(
    env.APP_BUILD_SHA,
    env.RENDER_GIT_COMMIT,
    env.VERCEL_GIT_COMMIT_SHA,
    env.GITHUB_SHA,
    env.COMMIT_SHA,
    env.SOURCE_VERSION,
    git(["rev-parse", "HEAD"]),
  );
  const sha = fullSha.slice(0, 5);
  const suffix = [date.slice(0, 10).replace(/-/g, "."), count, sha].filter(Boolean).join(".");
  return { date, fullSha, label: suffix ? `v0.${suffix}` : "" };
}
