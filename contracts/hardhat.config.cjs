require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ethers");
require("@typechain/hardhat");
require("dotenv").config();

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.warn("WARNING: PRIVATE_KEY not set in environment");
}

/** @type import('hardhat/types').HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    polygonAmoy: {
      type: 'http',
      url: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: privateKey ? [privateKey] : [],
      chainId: 80002,
    },
    polygon: {
      type: 'http',
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: privateKey ? [privateKey] : [],
      chainId: 137,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

module.exports = config;
