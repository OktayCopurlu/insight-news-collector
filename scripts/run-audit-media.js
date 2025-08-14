import dotenv from "dotenv";
import { exec as _exec } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(_exec);

dotenv.config();

async function main() {
  const hours = process.argv[2] || "48";
  const { stdout, stderr } = await exec(
    `node ./scripts/audit-missing-images.js ${hours}`
  );
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
