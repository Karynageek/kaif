// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./interface/ITokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Token is ERC20, ERC20Burnable, Ownable {
    bool public isExecuted;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, totalSupply_);
    }

    /**
     * @notice Executes TGE, startes vesting.
     * @param _vesting The vesting contract address.
     * @param _amount The amount of transfering.
     */
    function executeTGE(address _vesting, uint256 _amount) external onlyOwner {
        require(!isExecuted, "Token: TGE executed");

        transfer(_vesting, _amount);

        ITokenVesting(_vesting).setStartAt();

        isExecuted = true;
    }
}
