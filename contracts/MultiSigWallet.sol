// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MultiSigWallet is ReentrancyGuard {
    using ECDSA for bytes32;

    uint8 public threshold;
    uint256 public nonce;

    mapping(address => bool) public isOwners;

    event RequirementChanged(uint256 threshold);
    event Executed(address to, uint256 amount);
    event OwnerUpdated(address owner);

    constructor(address[] memory owners_) {
        threshold = uint8(owners_.length);

        require(threshold >= 2, "MultiSigWallet: threshold < 2");

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
        require(_to != address(0), "MultiSigWallet: zero address");

        _validateMultiSigWallet(_to, _amount, _data, nonce, _multiSignature);
        _transfer(_to, _amount, _data);

        nonce++;

        emit Executed(_to, _amount);
    }

    function updateOwner(address _owner, bool _isAdded) external {
        require(
            msg.sender == address(this),
            "MultiSigWallet: only via execute"
        );
        require(_owner != address(0), "MultiSigWallet: zero address");

        if (_isAdded) {
            require(!isOwners[_owner], "MultiSigWallet: owner exists");
            threshold += 1;
        } else {
            require(isOwners[_owner], "MultiSigWallet: owner !exists");
            threshold -= 1;
        }

        isOwners[_owner] = _isAdded;

        _changeRequirement(threshold);

        emit OwnerUpdated(_owner);
    }

    function _validateMultiSigWallet(
        address _to,
        uint256 _amount,
        bytes calldata _data,
        uint256 _nonce,
        bytes[] calldata _multiSignature
    ) private {
        uint8 count = uint8(_multiSignature.length);

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

        for (uint8 i = 0; i < count; i++) {
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

        emit RequirementChanged(_threshold);
    }
}
