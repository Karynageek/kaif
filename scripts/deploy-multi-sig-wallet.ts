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
  multiSigWallet = await MultiSigWallet.deploy(["0xF2A74B4d7E908fc8a86c2dFee3712ebc8E0A7293", "0xcc980f32bE2411d98375Dde14ba84EF7300977Ef", "0x369fb8f9Bb66119742101E305d87f1e5d5766Db4"]);
  await multiSigWallet.deployed();

  console.log("MultiSigWallet deployed to:", multiSigWallet.address);

  await delay(35000);

  await hre.run("verify:verify", {
    address: multiSigWallet.address,
    constructorArguments: [["0xF2A74B4d7E908fc8a86c2dFee3712ebc8E0A7293", "0xcc980f32bE2411d98375Dde14ba84EF7300977Ef", "0x369fb8f9Bb66119742101E305d87f1e5d5766Db4"]],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
