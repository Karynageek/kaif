// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./interface/ITokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Token is ERC20, ERC20Burnable, Ownable {
    bool public isExecuted;

    constructor(string memory _name, string memory _symbol)
        ERC20(_name, _symbol)
    {}

    function executeTGE(address vesting, uint256 amount) external onlyOwner {
        require(!isExecuted, "Token: TGE executed");

        _mint(vesting, amount);

        ITokenVesting(vesting).setStartAt();

        isExecuted = true;
    }
}
