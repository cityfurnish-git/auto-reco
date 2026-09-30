// GET /api/version — which build is actually serving this URL.
//
// Written 30 Sep 2026, during the move to the company's GitHub and Vercel. The
// repo said one thing, Vercel reported "deployment completed", and the site
// kept behaving like Friday's code — and there was no way to tell whether a
// fix was live except to re-run a day and watch what the engine did. A
// deployment you cannot identify is a deployment you cannot trust.
//
// Deliberately public and deliberately boring: the commit, the branch, when it
// was built and which environment. Nothing here is a secret — the repo is
// private, and a commit hash without access to it tells an outsider nothing.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    repo: process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : null,
    environment: process.env.VERCEL_ENV ?? "local",
    builtAt: process.env.VERCEL_DEPLOYMENT_ID ? new Date().toISOString() : null,
  });
}
