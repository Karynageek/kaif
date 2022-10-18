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
import { BigNumber } from "ethers";

async function incrementNextBlockTimestamp(amount: number): Promise<void> {
  return ethers.provider.send("evm_increaseTime", [amount]);
}

async function getBlockTimestamp(tx: any): Promise<number> {
  const minedTx = await tx.wait();
  const txBlock = await ethers.provider.getBlock(minedTx.blockNumber);
  return txBlock.timestamp;
}

function getDigest(
  multiSigWalletAddress: string,
  chainId: number,
  to: string,
  data: string,
  nonce: BigNumber,
): string {
  let message = ethers.utils.solidityPack(["address", "uint256", "address", "uint256", "bytes", "uint256"], [multiSigWalletAddress, chainId, to, 0, data, nonce]);

  message = ethers.utils.solidityKeccak256(["bytes"], [message]);

  return message;
}

async function getMultiSignatures(digest: string, signers: any[]): Promise<any[]> {
  signers.sort((x, y) => x.address > y.address ? 1 : -1);

  let signatures = [];

  for (let signer of signers) {
    let sign = await signer.signMessage(ethers.utils.arrayify(digest));

    signatures.push(sign);
  }

  return signatures;
}

describe('Vesting contract', () => {
  let token: Token;
  let vesting: Vesting;
  let multiSigWallet: MultiSigWallet;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let addr4: SignerWithAddress;
  let addrs: SignerWithAddress[];
  const name = "Orange Token";
  const symbol = "OT";
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const chainId = 31337;

  beforeEach(async () => {
    [owner, addr1, addr2, addr3, addr4, ...addrs] = await ethers.getSigners();

    const Token = (await ethers.getContractFactory('Token')) as Token__factory;
    token = await Token.deploy(name, symbol);
    await token.deployed();

    const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;
    multiSigWallet = await MultiSigWallet.deploy([addr1.address, addr2.address, addr3.address]);
    await multiSigWallet.deployed();

    const Vesting = (await ethers.getContractFactory('Vesting')) as Vesting__factory;
    vesting = await Vesting.deploy(token.address, multiSigWallet.address);
    await vesting.deployed();

    const amount = parseUnits("800000000", await token.decimals());
    await token.connect(owner).executeTGE(vesting.address, amount);
  });

  describe('initial values', async () => {
    it('should set roles', async () => {
      expect(await vesting.hasRole(await vesting.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
      expect(await vesting.hasRole(await vesting.MULTISIG_ROLE(), multiSigWallet.address)).to.equal(true);
      expect(await vesting.hasRole(await vesting.STARTER_ROLE(), token.address)).to.equal(true);
    })
  });

  describe('sets seed round vest for', async () => {
    it('sets seed round vest for successfully', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("200", 18)];
      const startAt = await vesting.startAt();
      const cliffInSeconds = 31104000;
      const durationsInSeconds = 82944000;
      const direction = 0;
      const totalAmountBefore = 0;
      const totalAmountAfter = parseUnits("100", 18).add(parseUnits("200", 18));

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await vesting.connect(owner).setSeedRoundVestFor(accounts, amounts);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "BatchVestingCreated")
        .withArgs(accounts, amounts, startAt);
    });

    it('rejects accounts and amounts lengths not match', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18)];

      await expect(vesting.connect(owner).setSeedRoundVestFor(accounts, amounts)).to.be.revertedWith("Vesting: accounts and amounts lengths not match");
    });

    it('rejects not sufficient tokens', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("900000000", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setSeedRoundVestFor(accounts, amounts)).to.be.revertedWith("Vesting: not sufficient tokens");
    });

    it('rejects incorrect amount', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("0", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setSeedRoundVestFor(accounts, amounts)).to.be.revertedWith("Vesting: incorrect amount");
    });

    it('rejects zero vester address', async () => {
      const accounts = [zeroAddress, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setSeedRoundVestFor(accounts, amounts)).to.be.revertedWith("Vesting: zero vester address");
    });
  });

  describe('sets private round one vest for', async () => {
    it('sets private round one vest for successfully', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("200", 18)];
      const startAt = await vesting.startAt();
      const cliffInSeconds = 15552000;
      const durationsInSeconds = 62208000;
      const direction = 1;
      const totalAmountBefore = 0;
      const totalAmountAfter = parseUnits("100", 18).add(parseUnits("200", 18));

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await vesting.connect(owner).setPrivateRoundOneVestFor(accounts, amounts);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "BatchVestingCreated")
        .withArgs(accounts, amounts, startAt);
    });

    it('rejects accounts and amounts lengths not match', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundOneVestFor(accounts, amounts)).to.be.revertedWith("Vesting: accounts and amounts lengths not match");
    });

    it('rejects not sufficient tokens', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("900000000", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundOneVestFor(accounts, amounts)).to.be.revertedWith("Vesting: not sufficient tokens");
    });

    it('rejects incorrect amount', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("0", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundOneVestFor(accounts, amounts)).to.be.revertedWith("Vesting: incorrect amount");
    });

    it('rejects zero vester address', async () => {
      const accounts = [zeroAddress, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundOneVestFor(accounts, amounts)).to.be.revertedWith("Vesting: zero vester address");
    });
  });

  describe('sets private round two vest for', async () => {
    it('sets private round two vest for successfully', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("200", 18)];
      const startAt = await vesting.startAt();
      const cliffInSeconds = 15552000;
      const durationsInSeconds = 62208000;
      const direction = 2;
      const totalAmountBefore = 0;
      const totalAmountAfter = parseUnits("100", 18).add(parseUnits("200", 18));

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await vesting.connect(owner).setPrivateRoundTwoVestFor(accounts, amounts);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "BatchVestingCreated")
        .withArgs(accounts, amounts, startAt);
    });

    it('rejects accounts and amounts lengths not match', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundTwoVestFor(accounts, amounts)).to.be.revertedWith("Vesting: accounts and amounts lengths not match");
    });

    it('rejects not sufficient tokens', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("900000000", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundTwoVestFor(accounts, amounts)).to.be.revertedWith("Vesting: not sufficient tokens");
    });

    it('rejects incorrect amount', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("0", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundTwoVestFor(accounts, amounts)).to.be.revertedWith("Vesting: incorrect amount");
    });

    it('rejects zero vester address', async () => {
      const accounts = [zeroAddress, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setPrivateRoundTwoVestFor(accounts, amounts)).to.be.revertedWith("Vesting: zero vester address");
    });
  });

  describe('sets marketing vest for', async () => {
    it('sets marketing vest for successfully', async () => {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliffInSeconds = 0;
      const durationsInSeconds = 62208000;
      const direction = 3;
      const totalAmountBefore = 0;
      const totalAmountAfter = amount

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await vesting.connect(owner).setMarketingVestFor(account, amount, cliffInSeconds, durationsInSeconds);
      const startAt = await getBlockTimestamp(tx);

      const vestedScheduleAfter = await vesting.getVestedSchedule(account, direction);

      expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt + cliffInSeconds);
      expect(vestedScheduleAfter.startAt).to.equal(startAt);
      expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
      expect(vestedScheduleAfter.totalAmount).to.equal(amount);
      expect(vestedScheduleAfter.released).to.equal(0);

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "VestingCreated")
        .withArgs(account, amount, startAt);
    });

    it('rejects duration must be > 0', async () => {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliffInSeconds = 0;
      const durationsInSeconds = 0;

      await expect(vesting.connect(owner).setMarketingVestFor(account, amount, cliffInSeconds, durationsInSeconds)).to.be.revertedWith("Vesting: duration must be > 0");
    });

    it('rejects not sufficient tokens', async () => {
      const account = addr1.address;
      const amount = parseUnits("900000000", 18);
      const cliffInSeconds = 0;
      const durationsInSeconds = 62208000;

      await expect(vesting.connect(owner).setMarketingVestFor(account, amount, cliffInSeconds, durationsInSeconds)).to.be.revertedWith("Vesting: not sufficient tokens");
    });

    it('rejects incorrect amount', async () => {
      const account = addr1.address;
      const amount = parseUnits("0", 18);
      const cliffInSeconds = 0;
      const durationsInSeconds = 62208000;

      await expect(vesting.connect(owner).setMarketingVestFor(account, amount, cliffInSeconds, durationsInSeconds)).to.be.revertedWith("Vesting: incorrect amount");
    });

    it('rejects zero vester address', async () => {
      const account = zeroAddress;
      const amount = parseUnits("100", 18);
      const cliffInSeconds = 0;
      const durationsInSeconds = 62208000;

      await expect(vesting.connect(owner).setMarketingVestFor(account, amount, cliffInSeconds, durationsInSeconds)).to.be.revertedWith("Vesting: zero vester address");
    });
  });

  describe('sets main team vest for', async () => {
    it('sets main team vest for successfully', async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];
      const amounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];
      const startAt = await vesting.startAt();
      const cliffInSeconds = 10368000;
      const durationsInSeconds = 62208000;
      const direction = 4;
      const totalAmountBefore = 0;
      const totalAmountAfter = parseUnits("100", 18).add(parseUnits("400", 18)).add(parseUnits("500", 18));

      expect(await vesting.foundersTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }

      expect(await vesting.foundersTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "BatchVestingCreated")
        .withArgs(accounts, amounts, startAt);
    });

    it('rejects accounts and amounts lengths not match', async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];
      const amounts = [parseUnits("100", 18), parseUnits("400", 18)];
      const percents = [10, 40, 50];

      await expect(vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents)).to.be.revertedWith("Vesting: data lengths not match");
    });

    it('rejects not sufficient tokens', async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];
      const amounts = [parseUnits("900000000", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await expect(vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents)).to.be.revertedWith("Vesting: not sufficient tokens");
    });

    it('rejects incorrect amount', async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];
      const amounts = [parseUnits("0", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await expect(vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents)).to.be.revertedWith("Vesting: incorrect amount");
    });

    it('rejects zero vester address', async () => {
      const accounts = [zeroAddress, addr2.address, addr3.address];
      const amounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await expect(vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents)).to.be.revertedWith("Vesting: zero vester address");
    });

    it('rejects count of founders shoud be 3', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("400", 18)];
      const percents = [10, 40];

      await expect(vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents)).to.be.revertedWith("Vesting: count of founders shoud be 3");
    });

    it('rejects total percent not 100', async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];
      const amounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 40];

      await expect(vesting.connect(owner).setMainTeamVestFor(accounts, amounts, percents)).to.be.revertedWith("Vesting: total percent not 100");
    });
  });

  describe('sets additional team vest for', async () => {
    it('sets additional team vest for successfully', async () => {
      const mainAccounts = [addr1.address, addr2.address, addr3.address];
      const mainAmounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await vesting.connect(owner).setMainTeamVestFor(mainAccounts, mainAmounts, percents);

      const nonce = await multiSigWallet.nonce();
      const accounts = [addr4.address];
      const amounts = [parseUnits("50", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      const startAt = await vesting.startAt();
      const cliffInSeconds = 10368000;
      const durationsInSeconds = 62208000;
      const direction = 4;

      const totalAmountAfter = parseUnits("50", 18);
      const totalAmountBefore = await vesting.getVestingSchedulesTotalAmount();
      const withdrawableAmountBefore = await vesting.getWithdrawableAmount();

      let mainTotalAmount: Map<string, BigNumber> = new Map([]);;

      for (let i = 0; i < mainAccounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(mainAccounts[i], direction);

        mainTotalAmount.set(mainAccounts[i], vestedScheduleAfter.totalAmount);
      }

      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }

      for (let i = 0; i < mainAccounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(mainAccounts[i], direction);

        const percent = await vesting.foundersPercent(mainAccounts[i]);

        let totalAmountBefore = mainTotalAmount.get(mainAccounts[i]) ?? parseUnits("0", 18);;

        expect(vestedScheduleAfter.totalAmount).to.equal(totalAmountBefore.sub(totalAmountAfter.mul(percent).div(100)));
      }

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore.add(totalAmountAfter));
      expect(await vesting.getWithdrawableAmount()).to.equal(withdrawableAmountBefore.sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "BatchVestingCreated")
        .withArgs(accounts, amounts, startAt);
    });

    it('rejects accounts and amounts lengths not match', async () => {
      const mainAccounts = [addr1.address, addr2.address, addr3.address];
      const mainAmounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await vesting.connect(owner).setMainTeamVestFor(mainAccounts, mainAmounts, percents);

      const nonce = await multiSigWallet.nonce();
      const accounts = [addr4.address];
      const amounts = [parseUnits("50", 18), parseUnits("50", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects if count of founders shoud be 3', async () => {
      const nonce = await multiSigWallet.nonce();
      const accounts = [addr4.address];
      const amounts = [parseUnits("50", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects if max total amount for team > 50%', async () => {
      const mainAccounts = [addr1.address, addr2.address, addr3.address];
      const mainAmounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await vesting.connect(owner).setMainTeamVestFor(mainAccounts, mainAmounts, percents);

      const nonce = await multiSigWallet.nonce();
      const accounts = [addr4.address];
      const amounts = [parseUnits("510", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects not sufficient tokens', async () => {
      const mainAccounts = [addr1.address, addr2.address, addr3.address];
      const mainAmounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await vesting.connect(owner).setMainTeamVestFor(mainAccounts, mainAmounts, percents);

      const nonce = await multiSigWallet.nonce();
      const accounts = [addr4.address];
      const amounts = [parseUnits("900000000", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects incorrect amount', async () => {
      const mainAccounts = [addr1.address, addr2.address, addr3.address];
      const mainAmounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await vesting.connect(owner).setMainTeamVestFor(mainAccounts, mainAmounts, percents);

      const nonce = await multiSigWallet.nonce();
      const accounts = [addr4.address];
      const amounts = [parseUnits("0", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects zero vester address', async () => {
      const mainAccounts = [addr1.address, addr2.address, addr3.address];
      const mainAmounts = [parseUnits("100", 18), parseUnits("400", 18), parseUnits("500", 18)];
      const percents = [10, 40, 50];

      await vesting.connect(owner).setMainTeamVestFor(mainAccounts, mainAmounts, percents);

      const nonce = await multiSigWallet.nonce();
      const accounts = [zeroAddress];
      const amounts = [parseUnits("50", 18)];

      let ABI = [
        "function setAdditionalTeamVestFor(address[] calldata _accounts, uint256[] calldata _amounts)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("setAdditionalTeamVestFor", [accounts, amounts])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });
  });

  describe('sets fondation vest for', async () => {
    it('sets fondation vest for successfully', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("200", 18)];
      const startAt = await vesting.startAt();
      const cliffInSeconds = 0;
      const durationsInSeconds = 49248000;
      const direction = 5;
      const totalAmountBefore = 0;
      const totalAmountAfter = parseUnits("100", 18).add(parseUnits("200", 18));

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountBefore));

      const tx = await vesting.connect(owner).setFoundationVestFor(accounts, amounts);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
      expect(await vesting.getWithdrawableAmount()).to.equal((await token.balanceOf(vesting.address)).sub(totalAmountAfter));

      await expect(tx).to.emit(vesting, "BatchVestingCreated")
        .withArgs(accounts, amounts, startAt);
    });

    it('rejects accounts and amounts lengths not match', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18)];

      await expect(vesting.connect(owner).setFoundationVestFor(accounts, amounts)).to.be.revertedWith("Vesting: accounts and amounts lengths not match");
    });

    it('rejects not sufficient tokens', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("900000000", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setFoundationVestFor(accounts, amounts)).to.be.revertedWith("Vesting: not sufficient tokens");
    });

    it('rejects incorrect amount', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("0", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setFoundationVestFor(accounts, amounts)).to.be.revertedWith("Vesting: incorrect amount");
    });

    it('rejects zero vester address', async () => {
      const accounts = [zeroAddress, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("100", 18)];

      await expect(vesting.connect(owner).setFoundationVestFor(accounts, amounts)).to.be.revertedWith("Vesting: zero vester address");
    });
  });

  describe('withdraws', async () => {
    it('withdraws successfully', async () => {
      const amount = parseUnits("100", 18);

      const withdrawableAmountBefore = await vesting.getWithdrawableAmount();

      expect(withdrawableAmountBefore).to.equal((await token.balanceOf(vesting.address)));

      const tx = await vesting.connect(owner).withdraw(amount);

      expect(await vesting.getWithdrawableAmount()).to.equal(withdrawableAmountBefore.sub(amount));

      await expect(tx).to.emit(token, "Transfer")
        .withArgs(vesting.address, owner.address, amount);
    });

    it('rejects not enough funds', async () => {

      const amount = (await vesting.getWithdrawableAmount()).add(parseUnits("100", 18));

      await expect(vesting.connect(owner).withdraw(amount)).to.be.revertedWith("Vesting: not enough funds");
    });
  });

  describe('gets withdrawable amount', async () => {
    it('gets withdrawable amount successfully', async () => {
      const amount = parseUnits("100", 18);

      const withdrawableAmountBefore = await vesting.getWithdrawableAmount();

      expect(withdrawableAmountBefore).to.equal((await token.balanceOf(vesting.address)));

      const tx = await vesting.connect(owner).withdraw(amount);

      expect(await vesting.getWithdrawableAmount()).to.equal(withdrawableAmountBefore.sub(amount));
    });
  });

  describe('gets vesting schedules total amount', async () => {
    it('gets vesting schedules total amount successfully', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("200", 18)];
      const totalAmountBefore = 0;
      const totalAmountAfter = parseUnits("100", 18).add(parseUnits("200", 18));

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountBefore);

      await vesting.connect(owner).setSeedRoundVestFor(accounts, amounts);

      expect(await vesting.getVestingSchedulesTotalAmount()).to.equal(totalAmountAfter);
    });
  });

  describe('gets vesting schedule', async () => {
    it('gets vesting schedule successfully', async () => {
      const accounts = [addr1.address, addr2.address];
      const amounts = [parseUnits("100", 18), parseUnits("200", 18)];
      const startAt = await vesting.startAt();
      const cliffInSeconds = 31104000;
      const durationsInSeconds = 82944000;
      const direction = 0;

      await vesting.connect(owner).setSeedRoundVestFor(accounts, amounts);

      for (let i = 0; i < accounts.length; i++) {
        const vestedScheduleAfter = await vesting.getVestedSchedule(accounts[i], direction);

        expect(vestedScheduleAfter.cliffInSeconds).to.equal(startAt.add(cliffInSeconds));
        expect(vestedScheduleAfter.startAt).to.equal(startAt);
        expect(vestedScheduleAfter.durationInSeconds).to.equal(durationsInSeconds);
        expect(vestedScheduleAfter.totalAmount).to.equal(amounts[i]);
        expect(vestedScheduleAfter.released).to.equal(0);
      }
    });
  });

  describe('gets vested amount', () => {
    it("gets vested amount if start at not begin", async function () {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 200;
      const duration = 1000;

      await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      const vestedAmount = await vesting.getVestedAmount(addr1.address);

      expect(vestedAmount).to.be.equal(0);
    });

    it("gets vested amount if cliff not begin", async function () {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 0;
      const duration = 1000;

      await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      const vestedAmount = await vesting.getVestedAmount(addr1.address);

      expect(vestedAmount).to.be.equal(0);
    });

    it("gets vested amount if vesting completed partly", async function () {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 0;
      const duration = 2592005;

      const tx = await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      const startAt = await getBlockTimestamp(tx);

      await incrementNextBlockTimestamp(2592001);
      await ethers.provider.send("evm_mine", []);

      const vestedAmount = await vesting.getVestedAmount(addr1.address);

      const blockNumAfter = await ethers.provider.getBlockNumber();
      const blockAfter = await ethers.provider.getBlock(blockNumAfter);
      const timestampAfter = blockAfter.timestamp;

      expect(vestedAmount).to.be.not.equal(0);
      expect(vestedAmount).to.be.equal(amount.mul(timestampAfter - startAt).div(duration));
    });

    it("gets vested amount if vesting completed fully", async function () {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 0;
      const duration = 1000;

      await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      await incrementNextBlockTimestamp(2592001);
      await ethers.provider.send("evm_mine", []);

      const vestedAmount = await vesting.getVestedAmount(addr1.address);

      expect(vestedAmount).to.be.not.equal(0);
      expect(vestedAmount).to.be.equal(amount);
    });
  });

  describe('claims', () => {
    it("claims with part rewards successfully", async () => {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 0;
      const duration = 2592005;
      const direction = 3;

      let tx = await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      const startAt = await getBlockTimestamp(tx);

      await incrementNextBlockTimestamp(2592000);
      await ethers.provider.send("evm_mine", []);

      const addr1BalanceBefore = await token.balanceOf(addr1.address);

      const vestingSchedulesTotalAmountBefore = await vesting.vestingSchedulesTotalAmount();
      const vestingSchedulesBefore = await vesting.getVestedSchedule(account, direction);

      tx = await vesting.connect(addr1).claim();

      const timestampAfter = await getBlockTimestamp(tx);

      const vestingSchedulesAfter = await vesting.getVestedSchedule(account, direction);
      const amountToClaim = await vesting.getVestedAmount(addr1.address);

      const vestedAmount = amount.mul(timestampAfter - startAt).div(duration);
      const addr1BalanceAfter = await token.balanceOf(addr1.address);

      expect(addr1BalanceAfter).to.be.equal(addr1BalanceBefore.add(vestedAmount));
      expect(await vesting.vestingSchedulesTotalAmount()).to.equal(vestingSchedulesTotalAmountBefore.sub(vestedAmount));
      expect(vestingSchedulesAfter.released).to.be.equal(vestingSchedulesBefore.released.add(vestedAmount));
      expect(amountToClaim).to.be.equal(0);
      await expect(tx).to.emit(vesting, 'Claimed')
        .withArgs(addr1.address, vestedAmount);
    });

    it("claims with all rewards successfully", async function () {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 0;
      const duration = 1000;
      const direction = 3;

      let tx = await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      await incrementNextBlockTimestamp(2592000);
      await ethers.provider.send("evm_mine", []);

      const addr1BalanceBefore = await token.balanceOf(addr1.address);

      const vestingSchedulesTotalAmountBefore = await vesting.vestingSchedulesTotalAmount();
      const vestingSchedulesBefore = await vesting.getVestedSchedule(account, direction);

      tx = await vesting.connect(addr1).claim();

      const vestingSchedulesAfter = await vesting.getVestedSchedule(account, direction);
      const amountToClaim = await vesting.getVestedAmount(addr1.address);

      const vestedAmount = amount;
      const addr1BalanceAfter = await token.balanceOf(addr1.address);

      expect(addr1BalanceAfter).to.be.equal(addr1BalanceBefore.add(vestedAmount));
      expect(await vesting.vestingSchedulesTotalAmount()).to.equal(vestingSchedulesTotalAmountBefore.sub(vestedAmount));
      expect(vestingSchedulesAfter.released).to.be.equal(vestingSchedulesBefore.released.add(vestedAmount));
      expect(amountToClaim).to.be.equal(0);
      await expect(tx).to.emit(vesting, 'Claimed')
        .withArgs(addr1.address, vestedAmount);
    });

    it("rejects claming when amount equal 0", async function () {
      const account = addr1.address;
      const amount = parseUnits("100", 18);
      const cliff = 200;
      const duration = 1000;

      await vesting.connect(owner).setMarketingVestFor(account, amount, cliff, duration);

      await expect(vesting.connect(addr1).claim()).to.be.revertedWith("Vesting: claim amount must be > 0");
    });
  });
});
