import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const ArticleRegistry = await ethers.getContractFactory("ArticleRegistry");
  const registry = await ArticleRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("ArticleRegistry deployed to:", address);
  console.log("Base Sepolia explorer:", `https://sepolia.basescan.org/address/${address}`);

  // Write address to a JSON file the Electron app will import
  const fs = await import("fs");
  const deployment = {
    network: "baseSepolia",
    chainId: 84532,
    address,
    deployedAt: new Date().toISOString()
  };
  fs.writeFileSync("../src/main/deployment.json", JSON.stringify(deployment, null, 2));
  console.log("Wrote deployment.json to src/main/");

  console.log("\nTo verify the source on BaseScan (needs BASESCAN_API_KEY in .env):");
  console.log(`  npx hardhat verify --network baseSepolia ${address}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
