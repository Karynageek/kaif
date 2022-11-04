import { expect } from "chai";
import { ethers } from "hardhat";
import { Token__factory } from "../typechain-types/factories/contracts/Token__factory";
import { Token } from "../typechain-types/contracts/Token";
import { Vesting__factory } from "../typechain-types/factories/contracts/Vesting__factory";
import { Vesting } from "../typechain-types/contracts/Vesting";
import { MultiSigWallet__factory } from "../typechain-types/factories/contracts/MultiSigWallet__factory";
import { MultiSigWallet } from "../typechain-types/contracts/MultiSigWallet";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseUnits } from "ethers/lib/utils";

describe('Token contract', () => {
  let token: Token;
  let vesting: Vesting;
  let multiSigWallet: MultiSigWallet;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let fundingWallet: SignerWithAddress;
  let addrs: SignerWithAddress[];
  const name = "Orange Token";
  const symbol = "OT";
  const totalSupply = parseUnits("800000000", 18);
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  async function getBlockTimestamp(tx: any): Promise<number> {
    const minedTx = await tx.wait();
    const txBlock = await ethers.provider.getBlock(minedTx.blockNumber);
    return txBlock.timestamp;
  }

  beforeEach(async () => {
    [owner, addr1, addr2, addr3, fundingWallet, ...addrs] = await ethers.getSigners();

    const Token = (await ethers.getContractFactory('Token')) as Token__factory;
    token = await Token.deploy(name, symbol, totalSupply);
    await token.deployed();

    const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;
    multiSigWallet = await MultiSigWallet.deploy([addr1.address, addr2.address, addr3.address]);
    await multiSigWallet.deployed();

    const Vesting = (await ethers.getContractFactory('Vesting')) as Vesting__factory;
    vesting = await Vesting.deploy(token.address, multiSigWallet.address);
    await vesting.deployed();
  });

  describe('executes TGE', async () => {
    it('executes TGE successfully', async () => {
      const amount = parseUnits("100", await token.decimals());
      const ownerBalanceBefore = await token.balanceOf(owner.address);
      const vestingBalanceBefore = await token.balanceOf(vesting.address);

      expect(await vesting.startAt()).to.equal(0);
      expect(await token.isExecuted()).to.equal(false);

      const tx = await token.connect(owner).executeTGE(vesting.address, amount);

      const txTimestamp = await getBlockTimestamp(tx);
      const ownerBalanceAfter = await token.balanceOf(owner.address);
      const vestingBalanceAfter = await token.balanceOf(vesting.address);

      expect(await vesting.startAt()).to.equal(txTimestamp);
      expect(await token.isExecuted()).to.equal(true);

      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore.sub(amount));
      expect(vestingBalanceAfter).to.equal(vestingBalanceBefore.add(amount));

      await expect(tx).to.emit(token, "Transfer")
        .withArgs(owner.address, vesting.address, amount);
    })

    it('rejects if TGE executed', async () => {
      const amount = parseUnits("100", await token.decimals());

      await token.connect(owner).executeTGE(vesting.address, amount);
      await expect(token.connect(owner).executeTGE(vesting.address, amount)).to.rejectedWith("Token: TGE executed");
    })
  });

});
