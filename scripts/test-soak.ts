import { spawn } from "node:child_process";

const runs = 10;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (let run = 1; run <= runs; run += 1) {
  console.log(`\nSoak run ${run}/${runs}`);
  await runTests();
}

console.log(`\nSoak passed: ${runs}/${runs} full test runs.`);

function runTests(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, ["test"], {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Test run exited ${code ?? "null"}.`))));
  });
}
