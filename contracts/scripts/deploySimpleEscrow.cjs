const hre = require("hardhat");

async function main() {
  // Get signers
  const signers = await hre.ethers.getSigners();
  console.log("Number of signers:", signers.length);
  
  if (signers.length === 0) {
    console.error("No signers found. Make sure PRIVATE_KEY is set in environment.");
    process.exit(1);
  }
  
  const deployer = signers[0];
  console.log("Deploying SimpleEscrow with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "MATIC");

  // Token address for Polygon Amoy
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0xF9f52599939C51168c72962ce7B6Dcf59CD22B10";
  console.log("Using token address:", TOKEN_ADDRESS);

  const SimpleEscrow = await hre.ethers.getContractFactory("SimpleEscrow");
  console.log("Deploying SimpleEscrow...");
  
  const escrow = await SimpleEscrow.deploy(TOKEN_ADDRESS);
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("SimpleEscrow deployed to:", escrowAddress);
  console.log("Token address:", TOKEN_ADDRESS);
  
  // Verify deployment
  console.log("\n--- Deployment Summary ---");
  console.log("Network: Polygon Amoy (Chain ID: 80002)");
  console.log("SimpleEscrow:", escrowAddress);
  console.log("Token:", TOKEN_ADDRESS);
  console.log("\nUpdate your .env file with:");
  console.log(`NEXT_PUBLIC_SIMPLE_ESCROW_ADDRESS=${escrowAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment error:", error);
    process.exit(1);
  });
