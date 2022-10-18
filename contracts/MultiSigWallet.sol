// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";

contract MultiSigWallet is ReentrancyGuard {
    uint8 public threshold;
    uint8 public ownersCount;
    uint256 public nonce;

    mapping(address => bool) public isOwners;
    mapping(address => bool) public signers;

    event RequirementChanged(uint256 threshold);
    event Executed(address to, uint256 amount);
    event OwnerUpdated(address owner);

    constructor(address[] memory owners_) {
        threshold = 3;

        require(
            owners_.length == threshold,
            "MultiSigWallet: !equal threshold"
        );

        for (uint256 i = 0; i < threshold; i++) {
            isOwners[owners_[i]] = true;
        }

        ownersCount = 3;
    }

    function execute(
        address _to,
        uint256 _amount,
        bytes calldata _data,
        bytes[] calldata _multiSignature
    ) external nonReentrant {
        require(_to != address(0), "MultiSigWallet: zero address");

        _validateMultiSigWallet(_to, _amount, _data, nonce, _multiSignature);
        _transfer(_to, _amount, _data);

        nonce++;

        emit Executed(_to, _amount);
    }

    function updateOwner(address owner, bool isAdded) external {
        require(
            msg.sender == address(this),
            "MultiSigWallet: only via execute"
        );
        require(owner != address(0), "MultiSigWallet: zero address");

        if (isAdded) {
            require(!isOwners[owner], "MultiSigWallet: owner exists");
            ownersCount += 1;
        } else {
            require(isOwners[owner], "MultiSigWallet: owner !exists");
            ownersCount -= 1;
        }

        isOwners[owner] = isAdded;

        _changeRequirement(ownersCount);

        emit OwnerUpdated(owner);
    }

    function _validateMultiSigWallet(
        address _to,
        uint256 _amount,
        bytes calldata _data,
        uint256 _nonce,
        bytes[] calldata _multiSignature
    ) private {
        uint256 count = _multiSignature.length;

        require(count == threshold, "MultiSigWallet: !enough signers");

        bytes32 digest = keccak256(
            abi.encodePacked(
                address(this),
                block.chainid,
                _to,
                _amount,
                _data,
                _nonce
            )
        );

        digest = ECDSA.toEthSignedMessageHash(digest);

        address initSignerAddress;

        for (uint256 i = 0; i < count; i++) {
            bytes memory signature = _multiSignature[i];
            address recovered = ECDSA.recover(digest, signature);

            require(
                recovered > initSignerAddress,
                "MultiSigWallet: double signature"
            );

            require(isOwners[recovered], "MultiSigWallet: wrong signature");

            initSignerAddress = recovered;
        }
    }

    function _transfer(
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) private {
        (bool success, ) = _to.call{value: _amount}(_data);

        require(success, "MultiSigWallet: transfer !ended");
    }

    function _changeRequirement(uint8 _threshold) private {
        require(_threshold >= 2, "MultiSigWallet: threshold < 2");

        threshold = _threshold;

        emit RequirementChanged(_threshold);
    }
}
