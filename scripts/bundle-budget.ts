import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const dist = path.resolve("packages/web/dist");
const html = await readFile(path.join(dist, "index.html"), "utf8");
const entry = html.match(/<script[^>]+src="\/(assets\/[^\"]+\.js)"/)?.[1];

if (!entry) {
  throw new Error("Web bundle has no module entry; cannot verify the initial JavaScript budget.");
}

const initial = new Set<string>([entry]);
const pending = [entry];
while (pending.length > 0) {
  const asset = pending.pop();
  if (!asset) {
    continue;
  }
  const source = await readFile(path.join(dist, asset), "utf8");
  for (const match of source.matchAll(/from["']\.\/(.+?\.js)["']/g)) {
    const dependency = path.posix.join(path.posix.dirname(asset), match[1]!);
    if (!initial.has(dependency)) {
      initial.add(dependency);
      pending.push(dependency);
    }
  }
}

const measured = await Promise.all(
  [...initial].map(async (asset) => ({
    asset,
    bytes: gzipSync(await readFile(path.join(dist, asset))).length
  }))
);
const largest = measured.sort((left, right) => right.bytes - left.bytes)[0];
const total = measured.reduce((sum, asset) => sum + asset.bytes, 0);
const lazyShiki = (await readdir(path.join(dist, "assets"))).filter((asset) => /^(?:core|engine-javascript)-.+\.js$/u.test(asset));
if (!largest || total >= 350 * 1024) {
  throw new Error(`Initial JavaScript exceeds the 350 kB gzip budget (${(total / 1024).toFixed(1)} kB across ${initial.size} chunk(s)).`);
}
if (lazyShiki.length < 2 || lazyShiki.some((asset) => initial.has(`assets/${asset}`))) {
  throw new Error("Shiki must remain in a non-initial lazy chunk.");
}

console.log(`bundle budget: ${(total / 1024).toFixed(1)} kB gzip across ${initial.size} initial chunk(s); largest ${largest.asset} ${(largest.bytes / 1024).toFixed(1)} kB; lazy Shiki ${lazyShiki.join(", ")}`);
