import hre, { ethers } from "hardhat";
import { Vesting__factory } from "../typechain-types/factories/contracts/Vesting__factory";
import { Vesting } from "../typechain-types/contracts/Vesting";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

async function main() {
  const delay = (ms: any) => new Promise((res) => setTimeout(res, ms));

  let vesting: Vesting;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let addrs: SignerWithAddress[];
  const tokenAddress = "0x0e4967270e79b2291c807996F68a36d246277aE6";
  const multiSigWalletAddress = "0xB867A326917F392579E3a30605fD3e16c5b90D58";

  [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

  const Vesting = (await ethers.getContractFactory('Vesting')) as Vesting__factory;
  vesting = await Vesting.deploy(tokenAddress, multiSigWalletAddress);
  await vesting.deployed();

  console.log("Vesting deployed to:", vesting.address);

  await delay(35000);

  await hre.run("verify:verify", {
    address: vesting.address,
    constructorArguments: [tokenAddress, multiSigWalletAddress],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
