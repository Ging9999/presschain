import { artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Post-deploy helper: copies the compiled ArticleRegistry ABI into the Electron
 * app's main process directory so it can construct the contract interface.
 *
 * Runs standalone (`npm run export-abi`) or is chained after deployment by the
 * `deploy:base-sepolia` npm script. It reads from Hardhat's artifacts so it only
 * requires a prior `hardhat compile` — no deployment needed.
 */
async function main() {
  const artifact = await artifacts.readArtifact("ArticleRegistry");

  const outPath = path.resolve(__dirname, "../../src/main/ArticleRegistry.abi.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2));

  console.log(`Wrote ABI (${artifact.abi.length} entries) to src/main/ArticleRegistry.abi.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
