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

        for (uint8 i = 0; i < threshold; i++) {
            isOwners[owners_[i]] = true;
        }
    }

    /**
     * @notice Execute a multi-signature transaction.
     * @param _to The destination address to send an outgoing transaction.
     * @param _amount The amount in Wei to be sent.
     * @param _data The data to send to the to when invoking the transaction.
     * @param _multiSignature The array of multi signatures.
     */
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

    /**
     * @notice Adding or removing signer.
     * @param _owner The signer address.
     * @param _isAdded If true, a new signer will be added, otherwise, remove.
     */
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

    /**
     * @notice Validates a multi-signature transaction.
     * @param _to The destination address to send an outgoing transaction.
     * @param _amount The amount in Wei to be sent.
     * @param _data The data to send to the to when invoking the transaction.
     * @param _nonce The unique id.
     * @param _multiSignature The array of multi signatures.
     */
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

    /**
     * @notice Transfer funds.
     * @param _to The recipient to send.
     * @param _amount The value to send.
     * @param _data the data to send to the to when invoking the transaction.
     */
    function _transfer(
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) private {
        // Success, send the transaction.
        (bool success, ) = _to.call{value: _amount}(_data);

        require(success, "MultiSigWallet: transfer !ended");
    }

    /**
     * @notice Changes count of signers.
     * @param _threshold The count of signers.
     */
    function _changeRequirement(uint8 _threshold) private {
        require(_threshold >= 2, "MultiSigWallet: threshold < 2");

        emit RequirementChanged(_threshold);
    }
}
