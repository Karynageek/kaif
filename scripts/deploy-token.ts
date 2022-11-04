import hre, { ethers } from "hardhat";
import { Token__factory } from "../typechain-types/factories/contracts/Token__factory";
import { Token } from "../typechain-types/contracts/Token";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";

async function main() {
  const delay = (ms: any) => new Promise((res) => setTimeout(res, ms));

  let token: Token;
  let addrs: SignerWithAddress[];
  const name = "Orange Token";
  const symbol = "OT";
  const totalSupply = parseUnits("800000000", 18);

  [...addrs] = await ethers.getSigners();

  const Token = (await ethers.getContractFactory('Token')) as Token__factory;
  token = await Token.deploy(name, symbol, totalSupply);
  await token.deployed();

  console.log("Token deployed to:", token.address);

  await delay(35000);

  await hre.run("verify:verify", {
    address: token.address,
    constructorArguments: [name, symbol, totalSupply],
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
