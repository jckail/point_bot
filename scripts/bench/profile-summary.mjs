/**
 * Summarises a V8 .cpuprofile (from `node --cpu-prof`): self time grouped by
 * source area and the top self-time functions.
 *
 *   node scripts/bench/profile-summary.mjs path/to/file.cpuprofile [--top=25]
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: profile-summary.mjs <file.cpuprofile> [--top=N]");
const top = Number((process.argv.find((a) => a.startsWith("--top=")) ?? "--top=25").slice(6));
const profile = JSON.parse(readFileSync(file, "utf8"));

const self = new Map(); // node id -> microseconds
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
const total = [...self.values()].reduce((a, b) => a + b, 0);

function area(url, fn) {
  if (!url) {
    if (fn === "(garbage collector)") return "gc";
    if (fn === "(idle)") return "idle";
    if (fn === "(program)") return "native/program";
    return "native/builtin";
  }
  if (url.startsWith("node:")) return "node internals";
  const m = url.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return `pkg:${m[1]}`;
  if (/\.next\/(server|standalone)|chunks/.test(url)) return "app bundle (next chunks, incl. bundled deps)";
  return "app source";
}
const byArea = new Map();
const byFn = new Map();
let idle = 0;
for (const node of profile.nodes) {
  const t = self.get(node.id) ?? 0;
  if (!t) continue;
  const { functionName: fn, url, lineNumber } = node.callFrame;
  if (fn === "(idle)") idle += t;
  const a = area(url, fn);
  byArea.set(a, (byArea.get(a) ?? 0) + t);
  const key = `${fn || "(anonymous)"} ${url ? url.split("/").slice(-2).join("/") + ":" + (lineNumber + 1) : ""}`;
  byFn.set(key, (byFn.get(key) ?? 0) + t);
}
const busy = total - idle;
const pct = (t) => `${((t / busy) * 100).toFixed(1)}%`.padStart(6);
const ms = (t) => `${(t / 1000).toFixed(0)}ms`.padStart(8);
console.log(`profile: ${file}\nsampled ${(total / 1e6).toFixed(1)}s, busy ${(busy / 1e6).toFixed(1)}s (percentages are of busy time)\n\nSelf time by area`);
for (const [k, t] of [...byArea].sort((a, b) => b[1] - a[1]).filter(([k]) => k !== "idle").slice(0, 12)) {
  console.log(pct(t), ms(t), k);
}
console.log(`\nTop ${top} self-time functions`);
for (const [k, t] of [...byFn].sort((a, b) => b[1] - a[1]).filter(([k]) => !k.startsWith("(idle)")).slice(0, top)) {
  console.log(pct(t), ms(t), k);
}
