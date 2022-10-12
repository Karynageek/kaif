import { expect } from "chai";
import { ethers } from "hardhat";
import { Token__factory } from "../typechain-types/factories/contracts/Token__factory";
import { Token } from "../typechain-types/contracts/Token";
import { Vesting__factory } from "../typechain-types/factories/contracts/Vesting__factory";
import { Vesting } from "../typechain-types/contracts/Vesting";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";

describe('Token contract', () => {
  let token: Token;
  let vesting: Vesting;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let fundingWallet: SignerWithAddress;
  let addrs: SignerWithAddress[];
  const name = "Orange Token";
  const symbol = "OT";
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  async function getBlockTimestamp(tx: any): Promise<number> {
    const minedTx = await tx.wait();
    const txBlock = await ethers.provider.getBlock(minedTx.blockNumber);
    return txBlock.timestamp;
  }

  beforeEach(async () => {
    [owner, addr1, addr2, addr3, fundingWallet, ...addrs] = await ethers.getSigners();

    const Token = (await ethers.getContractFactory('Token')) as Token__factory;
    token = await Token.deploy(name, symbol);
    await token.deployed();

    const Vesting = (await ethers.getContractFactory('Vesting')) as Vesting__factory;
    vesting = await Vesting.deploy(token.address);
    await vesting.deployed();
  });

  describe('executes TGE', async () => {
    it('executes TGE successfully', async () => {
      const vestingBalanceBefore = await token.balanceOf(vesting.address);
      const totalSupplyBefore = await token.totalSupply();

      expect(await vesting.startAt()).to.equal(0);

      const amount = parseUnits("100", await token.decimals());

      const tx = await token.connect(owner).executeTGE(vesting.address, amount);

      const txTimestamp = await getBlockTimestamp(tx);

      const vestingBalanceAfter = await token.balanceOf(vesting.address);
      const totalSupplyAfter = await token.totalSupply();

      expect(await vesting.startAt()).to.equal(txTimestamp);

      expect(vestingBalanceAfter).to.equal(vestingBalanceBefore.add(amount));
      expect(totalSupplyAfter).to.equal(totalSupplyBefore.add(amount));

      await expect(tx).to.emit(token, "Transfer")
        .withArgs(zeroAddress, vesting.address, amount);
    })
  })
});