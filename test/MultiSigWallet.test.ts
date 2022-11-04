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

describe('MultiSigWallet contract', () => {
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
  const totalSupply = parseUnits("800000000", 18);
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const chainId = 31337;

  beforeEach(async () => {
    [owner, addr1, addr2, addr3, addr4, ...addrs] = await ethers.getSigners();

    const Token = (await ethers.getContractFactory('Token')) as Token__factory;
    token = await Token.deploy(name, symbol, totalSupply);
    await token.deployed();
  });

  describe('initial values', async () => {
    it('shoud set owners', async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];

      const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;
      multiSigWallet = await MultiSigWallet.deploy(accounts);
      await multiSigWallet.deployed();

      for (let i = 0; i < accounts.length; i++) {
        expect(await multiSigWallet.isOwners(accounts[i])).to.equal(true);
      }
    });

    it('rejects if threshold < 2', async () => {
      const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;

      await expect(MultiSigWallet.deploy([addr1.address])).to.be.revertedWith("MultiSigWallet: threshold < 2");
    });
  });

  describe('executes', async () => {
    beforeEach(async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];

      const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;
      multiSigWallet = await MultiSigWallet.deploy(accounts);
      await multiSigWallet.deployed();

      const Vesting = (await ethers.getContractFactory('Vesting')) as Vesting__factory;
      vesting = await Vesting.deploy(token.address, multiSigWallet.address);
      await vesting.deployed();

      const amount = parseUnits("800000000", await token.decimals());
      await token.connect(owner).executeTGE(vesting.address, amount);
    });

    it('executes successfully', async () => {
      const nonce = await multiSigWallet.nonce();
      const oldOwner = addr3.address;

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [oldOwner, false])
      const signers = [addr1, addr2, addr3];
      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, signers);

      expect(await multiSigWallet.threshold()).to.equal(signers.length);
      expect(await multiSigWallet.isOwners(oldOwner)).to.equal(true);

      let tx = await multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures);

      expect(await multiSigWallet.isOwners(oldOwner)).to.equal(false);
      expect(await multiSigWallet.threshold()).to.equal(signers.length - 1);

      await expect(tx).to.emit(multiSigWallet, "OwnerUpdated")
        .withArgs(oldOwner);

      const newOwner = addr3.address;
      const nonce2 = await multiSigWallet.nonce();

      let ABI2 = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface2 = new ethers.utils.Interface(ABI2);
      const data2 = iface2.encodeFunctionData("updateOwner", [newOwner, true])

      let digest2 = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data2, nonce2);
      let signatures2 = await getMultiSignatures(digest2, [addr1, addr2]);

      await multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data2, signatures2);

      expect(await multiSigWallet.isOwners(newOwner)).to.equal(true);

      await expect(tx).to.emit(multiSigWallet, "OwnerUpdated")
        .withArgs(oldOwner);
    });

    it('rejects if zero address', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr3.address, false])

      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(zeroAddress, 0, data, signatures)).to.be.revertedWith("MultiSigWallet: zero address");
    });

    it('rejects if transfer !ended', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr4.address, true])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.revertedWith("MultiSigWallet: transfer !ended");
    });

    it('rejects if !enough signers', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr3.address, false])

      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr3]);

      await expect(multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures)).to.be.revertedWith("MultiSigWallet: !enough signers");
    });

    it('rejects if double signature', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr3.address, false])

      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr1, addr3]);

      await expect(multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures)).to.be.revertedWith("MultiSigWallet: double signature");
    });

    it('rejects if wrong signature', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr3.address, false])

      let digest = getDigest(multiSigWallet.address, chainId + 1, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures)).to.be.revertedWith("MultiSigWallet: wrong signature");
    });
  });

  describe('updates owner', () => {
    beforeEach(async () => {
      const accounts = [addr1.address, addr2.address, addr3.address];

      const MultiSigWallet = (await ethers.getContractFactory('MultiSigWallet')) as MultiSigWallet__factory;
      multiSigWallet = await MultiSigWallet.deploy(accounts);
      await multiSigWallet.deployed();

      const Vesting = (await ethers.getContractFactory('Vesting')) as Vesting__factory;
      vesting = await Vesting.deploy(token.address, multiSigWallet.address);
      await vesting.deployed();

      const amount = parseUnits("800000000", await token.decimals());
      await token.connect(owner).executeTGE(vesting.address, amount);
    });

    it('should remove owner successfully', async () => {
      const nonce = await multiSigWallet.nonce();
      const oldOwner = addr3.address;

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [oldOwner, false])
      const signers = [addr1, addr2, addr3];
      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, signers);

      expect(await multiSigWallet.threshold()).to.equal(signers.length);
      expect(await multiSigWallet.isOwners(oldOwner)).to.equal(true);

      let tx = await multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures);

      expect(await multiSigWallet.isOwners(oldOwner)).to.equal(false);
      expect(await multiSigWallet.threshold()).to.equal(signers.length - 1);

      await expect(tx).to.emit(multiSigWallet, "OwnerUpdated")
        .withArgs(oldOwner);
    });

    it('should add owner successfully', async () => {
      const nonce = await multiSigWallet.nonce();
      const newOwner = addr4.address;

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [newOwner, true])
      const signers = [addr1, addr2, addr3];
      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, signers);

      expect(await multiSigWallet.threshold()).to.equal(signers.length);
      expect(await multiSigWallet.isOwners(newOwner)).to.equal(false);

      let tx = await multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures);

      expect(await multiSigWallet.isOwners(newOwner)).to.equal(true);
      expect(await multiSigWallet.threshold()).to.equal(signers.length + 1);

      await expect(tx).to.emit(multiSigWallet, "OwnerUpdated")
        .withArgs(newOwner);
    });

    it('rejects if not via execute', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr4.address, true])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects if zero address', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [zeroAddress, true])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects adding if owner exists', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr1.address, true])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects removing if owner !exists', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr4.address, false])

      let digest = getDigest(multiSigWallet.address, chainId, vesting.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(vesting.address, 0, data, signatures)).to.be.reverted;
    });

    it('rejects if threshold < 2', async () => {
      const nonce = await multiSigWallet.nonce();

      let ABI = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface = new ethers.utils.Interface(ABI);
      const data = iface.encodeFunctionData("updateOwner", [addr3.address, false])

      let digest = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data, nonce);
      let signatures = await getMultiSignatures(digest, [addr1, addr2, addr3]);

      await multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures);

      const nonce2 = await multiSigWallet.nonce();

      let ABI2 = [
        "function updateOwner(address owner, bool isAdded)"
      ];

      let iface2 = new ethers.utils.Interface(ABI2);
      const data2 = iface2.encodeFunctionData("updateOwner", [addr2.address, false])

      let digest2 = getDigest(multiSigWallet.address, chainId, multiSigWallet.address, data2, nonce2);
      let signatures2 = await getMultiSignatures(digest2, [addr1, addr2, addr3]);

      await expect(multiSigWallet.connect(owner).execute(multiSigWallet.address, 0, data, signatures2)).to.be.reverted;
    });
  });

});
