// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MultiSigWallet is ReentrancyGuard {
    uint8 public threshold;
    uint8 public ownersCount;
    uint256 public nonce;

    mapping(uint256 => bool) public nonces;
    mapping(address => bool) public isOwners;
    mapping(address => bool) public signers;

    event RequirementChanged(uint256 threshold);
    event Executed(address to, uint256 amount);
    event OwnerAdded(address owner);
    event OwnerRemoved(address owner);

    constructor(address[] memory owners_) {
        threshold = 3;

        require(owners_.length == threshold, "MultiSig: not equal threshold");

        for (uint256 i = 0; i < threshold; i++) {
            isOwners[owners_[i]] = true;
        }
    }

    function execute(
        address _to,
        uint256 _amount,
        bytes calldata _data,
        bytes[] calldata _multiSignature
    ) external nonReentrant {
        require(_to != address(0), "MultiSig: zero address");
        require(nonces[nonce] == false, "MultiSig: execution completed");

        _validateMultiSignature(_to, _amount, _data, nonce, _multiSignature);
        _transfer(_to, _amount, _data);

        nonces[nonce] = true;
        nonce++;

        emit Executed(_to, _amount);
    }

    function _validateMultiSignature(
        address _to,
        uint256 _amount,
        bytes calldata _data,
        uint256 _nonce,
        bytes[] calldata _multiSignature
    ) private {
        uint256 count = _multiSignature.length;

        require(count == threshold, "MultiSig: not enough signers");

        bytes32 msgHash = ECDSA.toEthSignedMessageHash(
            _getMsgHash(_to, _amount, _data, _nonce)
        );

        mapping(address => bool) storage initSigners = signers;

        for (uint256 i = 0; i < count; i++) {
            bytes memory signature = _multiSignature[i];
            address recovered = ECDSA.recover(msgHash, signature);

            require(!initSigners[recovered], "MultiSig: duplicate signature");
            require(isOwners[recovered], "MultiSig: wrong signature");

            initSigners[recovered] = true;
        }
    }

    function _getMsgHash(
        address _receiver,
        uint256 _amount,
        bytes calldata _data,
        uint256 _nonce
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    address(this),
                    block.chainid,
                    _receiver,
                    _amount,
                    _data,
                    _nonce
                )
            );
    }

    function _transfer(
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) private {
        (bool success, ) = payable(_to).call{value: _amount}(_data);

        require(success, "Transfer not fulfilled");
    }

    function addOwner(address owner) external {
        require(msg.sender == address(this));
        require(owner != address(0), "MultiSig: owner is zero address");
        require(!isOwners[owner], "MultiSig: owner is exist");

        isOwners[owner] = true;
        ownersCount += 1;

        _changeRequirement(ownersCount);

        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external {
        require(msg.sender == address(this));
        require(owner != address(0), "MultiSig: owner is zero address");
        require(!isOwners[owner], "MultiSig: owner not exist");

        isOwners[owner] = false;
        ownersCount -= 1;

        _changeRequirement(ownersCount);

        emit OwnerRemoved(owner);
    }

    function _changeRequirement(uint8 _threshold) private {
        require(_threshold >= 2, "MultiSig: at least 2 signers should be");

        threshold = _threshold;

        emit RequirementChanged(_threshold);
    }
}
