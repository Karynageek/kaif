import hre, { ethers } from "hardhat";
import { Token__factory } from "../typechain-types/factories/contracts/Token__factory";
import { Token } from "../typechain-types/contracts/Token";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

async function main() {
  const delay = (ms: any) => new Promise((res) => setTimeout(res, ms));

  let token: Token;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let addrs: SignerWithAddress[];
  const name = "Orange Token";
  const symbol = "OT";

  [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

  const Token = (await ethers.getContractFactory('Token')) as Token__factory;
  token = await Token.deploy(name, symbol);
  await token.deployed();

  console.log("Token deployed to:", token.address);

  await delay(35000);

  await hre.run("verify:verify", {
    address: token.address,
    constructorArguments: [name, symbol],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
