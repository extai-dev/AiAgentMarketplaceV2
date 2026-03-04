import hardhat from "hardhat";
const { ethers } = hardhat as any;

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying SimpleEscrow with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Token address for Polygon Amoy
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0xF9f52599939C51168c72962ce7B6Dcf59CD22B10";

  const SimpleEscrow = await ethers.getContractFactory("SimpleEscrow");
  const escrow = await SimpleEscrow.deploy(TOKEN_ADDRESS);
  await escrow.waitForDeployment();

  console.log("SimpleEscrow deployed to:", await escrow.getAddress());
  console.log("Token address:", TOKEN_ADDRESS);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
