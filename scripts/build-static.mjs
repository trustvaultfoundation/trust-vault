// Static export for Arweave/ArNS hosting.
// `output: "export"` can't coexist with server route handlers, so we temporarily move
// the one remaining server route (src/app/api, holding the platform-wallet ArNS
// minter) out of the tree, build to ./out, then put it back. Everything else is
// client-side (gql + tx now call the gateways directly), so it runs fully static.
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";

const API = "src/app/api";
const TMP = "src/.api-static-tmp";
const hadApi = existsSync(API);

if (hadApi) renameSync(API, TMP);
let code = 0;
try {
  // NEXT_PUBLIC_STATIC_EXPORT is inlined into the client bundle so the app knows it's
  // running on the server-less Arweave host (e.g. to show ArNS as "coming soon" unless
  // a serverless mint backend URL was also configured).
  execSync("next build", { stdio: "inherit", env: { ...process.env, STATIC_EXPORT: "1", NEXT_PUBLIC_STATIC_EXPORT: "1" } });
} catch (e) {
  code = typeof e?.status === "number" ? e.status : 1;
} finally {
  if (hadApi && existsSync(TMP)) renameSync(TMP, API);
}
process.exit(code);
