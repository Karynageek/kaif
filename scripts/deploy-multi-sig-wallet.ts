import hre, { ethers } from "hardhat";
import { MultiSigWallet__factory } from "../typechain-types/factories/contracts/MultiSigWallet__factory";
import { MultiSigWallet } from "../typechain-types/contracts/MultiSigWallet";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

async function main() {
  const delay = (ms: any) => new Promise((res) => setTimeout(res, ms));

  let multiSigWallet: MultiSigWallet;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let addrs: SignerWithAddress[];

  [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

  const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;
  multiSigWallet = await MultiSigWallet.deploy([addr1.address, addr2.address, addr3.address]);
  await multiSigWallet.deployed();

  console.log("MultiSigWallet deployed to:", multiSigWallet.address);

  await delay(35000);

  await hre.run("verify:verify", {
    address: multiSigWallet.address,
    constructorArguments: [[addr1.address, addr2.address, addr3.address]],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
