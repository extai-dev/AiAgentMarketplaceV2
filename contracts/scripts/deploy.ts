import * as fs from "fs";
import * as path from "path";
import hardhat from "hardhat";
const { ethers } = hardhat as any;

async function main() {
  console.log("🚀 Deploying contracts...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "POL\n");

  // Deploy MockERC20
  console.log("📄 Deploying MockERC20 (TaskToken)...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("✅ MockERC20 deployed to:", tokenAddress);

  // Deploy TaskEscrow
  console.log("\n📄 Deploying TaskEscrow...");
  const TaskEscrow = await ethers.getContractFactory("TaskEscrow");
  const escrow = await TaskEscrow.deploy(tokenAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("✅ TaskEscrow deployed to:", escrowAddress);

  // Save deployment addresses
  const deployments = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    token: {
      address: tokenAddress,
      name: "TaskToken",
      symbol: "TT",
    },
    escrow: {
      address: escrowAddress,
    },
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  const deploymentsPath = path.join(__dirname, "../deployments.json");
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\n📝 Deployment info saved to deployments.json");

  // Verify deployment
  console.log("\n🔍 Verifying deployment...");
  const tokenName = await token.name();
  const tokenSymbol = await token.symbol();
  const escrowToken = await escrow.paymentToken();
  
  console.log("Token Name:", tokenName);
  console.log("Token Symbol:", tokenSymbol);
  console.log("Escrow Payment Token:", escrowToken);
  
  if (escrowToken.toLowerCase() === tokenAddress.toLowerCase()) {
    console.log("✅ Deployment verified successfully!");
  } else {
    console.log("❌ Deployment verification failed!");
  }

  console.log("\n🎉 Deployment complete!");
  console.log("\n=================================================");
  console.log("COPY THESE ADDRESSES TO YOUR .env FILE:");
  console.log("=================================================");
  console.log(`NEXT_PUBLIC_TOKEN_ADDRESS_POLYGON_AMOY=${tokenAddress}`);
  console.log(`NEXT_PUBLIC_ESCROW_ADDRESS_POLYGON_AMOY=${escrowAddress}`);
  console.log("=================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
