// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./interface/ITokenVesting.sol";
import "./Token.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract Vesting is AccessControl, ITokenVesting, ReentrancyGuard {
    using SafeERC20 for Token;
    using Math for uint256;

    bytes32 public constant MULTISIG_ROLE = keccak256("MULTISIG_ROLE");
    bytes32 public constant STARTER_ROLE = keccak256("STARTER_ROLE");
    uint8 public constant DIRECTION_COUNT = 7;
    uint8 public constant MAIN_TEAM_REQUIRED_COUNT = 3;
    uint256 public constant MAX_ROUNDS_AMOUNT = 240000000 * 10**18;
    uint256 public constant MAX_MARKETING_AMOUNT = 160000000 * 10**18;
    uint256 public constant MAX_TEAM_AMOUNT = 120000000 * 10**18;
    uint256 public constant MAX_FOUNDATION_AMOUNT = 80000000 * 10**18;

    Token public immutable token;

    uint128 public startAt;

    uint256 public roundsTotalAmount;
    uint256 public marketingTotalAmount;
    uint256 public additionalTeamTotalAmount;
    uint256 public mainTeamTotalAmount;
    uint256 public fondationTotalAmount;

    uint256 public vestingSchedulesTotalAmount;

    mapping(address => uint256) public foundersPercent;
    mapping(address => mapping(uint8 => VestingSchedule))
        public vestingSchedules;

    address[] public founders;

    enum Direction {
        PUBLIC_ROUND,
        SEED_ROUND,
        PRIVATE_ROUND_ONE,
        PRIVATE_ROUND_TWO,
        MARKETING,
        TEAM,
        FOUNDATION
    }

    struct VestingSchedule {
        uint128 cliffInSeconds;
        uint128 startAt;
        uint128 durationInSeconds;
        uint256 totalAmount;
        uint256 released;
        uint8 earlyUnlockPercent;
        uint256 earlyUnlockAmount;
    }

    event Claimed(address account, uint256 amount);
    event VestingCreated(address account, uint256 amount, uint128 startAt);
    event BatchVestingCreated(
        address[] accounts,
        uint256[] amounts,
        uint128 startAt
    );

    constructor(address token_, address multisig_) {
        token = Token(token_);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MULTISIG_ROLE, multisig_);
        _grantRole(STARTER_ROLE, token_);
    }

    function setStartAt() external onlyRole(STARTER_ROLE) {
        startAt = uint128(block.timestamp);
    }

    function setPublicRoundVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 totalAmount = _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            0,
            180 days,
            10,
            uint8(Direction.PUBLIC_ROUND)
        );

        require(
            roundsTotalAmount + totalAmount <= MAX_ROUNDS_AMOUNT,
            "Vesting: total amount exceeded"
        );
    }

    function setSeedRoundVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 totalAmount = _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            360 days,
            960 days,
            0,
            uint8(Direction.SEED_ROUND)
        );

        require(
            roundsTotalAmount + totalAmount <= MAX_ROUNDS_AMOUNT,
            "Vesting: total amount exceeded"
        );
    }

    function setPrivateRoundOneVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 totalAmount = _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            180 days,
            720 days,
            10,
            uint8(Direction.PRIVATE_ROUND_ONE)
        );

        require(
            roundsTotalAmount + totalAmount <= MAX_ROUNDS_AMOUNT,
            "Vesting: total amount exceeded"
        );
    }

    function setPrivateRoundTwoVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 totalAmount = _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            180 days,
            720 days,
            10,
            uint8(Direction.PRIVATE_ROUND_TWO)
        );

        require(
            roundsTotalAmount + totalAmount <= MAX_ROUNDS_AMOUNT,
            "Vesting: total amount exceeded"
        );
    }

    function setMarketingVestFor(
        address _account,
        uint256 _amount,
        uint128 _cliff,
        uint128 _duration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _vestFor(
            _account,
            _amount,
            uint128(block.timestamp),
            _cliff,
            _duration,
            2,
            uint8(Direction.MARKETING)
        );

        require(
            marketingTotalAmount + _amount <= MAX_MARKETING_AMOUNT,
            "Vesting: total amount exceeded"
        );

        emit VestingCreated(_account, _amount, uint128(block.timestamp));
    }

    function setMainTeamVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts,
        uint8[] calldata _percents
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint8 accountsCount = uint8(_accounts.length);

        require(
            accountsCount == _amounts.length &&
                accountsCount == _percents.length,
            "Vesting: data lengths !match"
        );

        require(
            founders.length + accountsCount == MAIN_TEAM_REQUIRED_COUNT,
            "Vesting: founders should be 3"
        );

        uint8 totalPercent;
        uint256 totalAmount;

        for (uint8 i = 0; i < accountsCount; i++) {
            totalAmount += _amounts[i];

            _vestFor(
                _accounts[i],
                _amounts[i],
                startAt,
                120 days,
                720 days,
                0,
                uint8(Direction.TEAM)
            );

            totalPercent += _percents[i];
            foundersPercent[_accounts[i]] = _percents[i];
            founders.push(_accounts[i]);
            mainTeamTotalAmount += _amounts[i];
        }

        require(totalPercent == 100, "Vesting: total percent !100");
        require(
            mainTeamTotalAmount + totalAmount <= MAX_TEAM_AMOUNT,
            "Vesting: total amount exceeded"
        );

        emit BatchVestingCreated(_accounts, _amounts, startAt);
    }

    function setAdditionalTeamVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(MULTISIG_ROLE) {
        uint8 accountsCount = uint8(_accounts.length);
        uint8 foundersCount = uint8(founders.length);

        require(
            accountsCount == _amounts.length,
            "Vesting: data lengths !match"
        );
        require(
            foundersCount == MAIN_TEAM_REQUIRED_COUNT,
            "Vesting: founders shoud be 3"
        );

        uint8 direction = uint8(Direction.TEAM);

        uint256 totalAmount;

        for (uint8 i = 0; i < accountsCount; i++) {
            totalAmount += _amounts[i];
            additionalTeamTotalAmount += _amounts[i];

            require(
                (additionalTeamTotalAmount * 100) / mainTeamTotalAmount <= 50,
                "Vesting: team max amount <= 50%"
            );

            _vestFor(
                _accounts[i],
                _amounts[i],
                startAt,
                120 days,
                720 days,
                0,
                direction
            );
        }

        for (uint8 i = 0; i < foundersCount; i++) {
            vestingSchedules[founders[i]][direction].totalAmount -=
                (additionalTeamTotalAmount * foundersPercent[founders[i]]) /
                100;
        }

        require(
            additionalTeamTotalAmount + mainTeamTotalAmount + totalAmount <=
                MAX_TEAM_AMOUNT,
            "Vesting: total amount exceeded"
        );

        emit BatchVestingCreated(_accounts, _amounts, startAt);
    }

    function setFoundationVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 totalAmount = _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            0,
            570 days,
            5,
            uint8(Direction.FOUNDATION)
        );

        require(
            fondationTotalAmount + totalAmount <= MAX_FOUNDATION_AMOUNT,
            "Vesting: total amount exceeded"
        );
    }

    function withdraw(uint256 _amount)
        public
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(getWithdrawableAmount() >= _amount, "Vesting: !enough funds");

        token.safeTransfer(msg.sender, _amount);
    }

    function claim() external {
        uint256 totalVestedAmount = 0;

        for (uint8 i = 0; i < DIRECTION_COUNT; i++) {
            uint256 vestedAmount = _vestedAmount(
                vestingSchedules[msg.sender][i]
            );

            if (vestedAmount > 0) {
                vestingSchedules[msg.sender][i].released += vestedAmount;
            }

            totalVestedAmount += vestedAmount;
        }

        require(totalVestedAmount > 0, "Vesting: claim amount is 0");

        vestingSchedulesTotalAmount -= totalVestedAmount;

        token.safeTransfer(msg.sender, totalVestedAmount);

        emit Claimed(msg.sender, totalVestedAmount);
    }

    function getVestedAmount(address _account)
        public
        view
        returns (uint256 totalVestedAmount)
    {
        for (uint8 i = 0; i < DIRECTION_COUNT; i++) {
            uint256 vestedAmount = _vestedAmount(vestingSchedules[_account][i]);

            totalVestedAmount += vestedAmount;
        }
    }

    function getWithdrawableAmount() public view returns (uint256) {
        return token.balanceOf(address(this)) - vestingSchedulesTotalAmount;
    }

    function _batchVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts,
        uint128 _startAt,
        uint128 _cliff,
        uint128 _duration,
        uint8 _unlockPercent,
        uint8 _direction
    ) private returns (uint256 totalAmount) {
        uint8 accountsCount = uint8(_accounts.length);

        require(
            accountsCount == _amounts.length,
            "Vesting: data lengths !match"
        );

        for (uint8 i = 0; i < accountsCount; i++) {
            totalAmount += _amounts[i];

            _vestFor(
                _accounts[i],
                _amounts[i],
                _startAt,
                _cliff,
                _duration,
                _unlockPercent,
                _direction
            );
        }

        emit BatchVestingCreated(_accounts, _amounts, _startAt);
    }

    function _vestFor(
        address _account,
        uint256 _amount,
        uint128 _startAt,
        uint128 _cliff,
        uint128 _duration,
        uint8 _unlockPercent,
        uint8 _direction
    ) private {
        require(
            getWithdrawableAmount() >= _amount,
            "Vesting: !sufficient tokens"
        );
        require(_amount != 0, "Vesting: incorrect amount");
        require(_duration != 0, "Vesting: duration must be > 0");
        require(_account != address(0), "Vesting: zero address");
        require(_startAt != 0, "Vesting: !started");

        vestingSchedulesTotalAmount += _amount;

        uint128 cliff = _startAt + _cliff;
        uint256 unlockAmount = (_amount * _unlockPercent) / 100;

        vestingSchedules[_account][_direction] = VestingSchedule(
            cliff,
            _startAt,
            _duration,
            _amount,
            0,
            _unlockPercent,
            unlockAmount
        );
    }

    function _vestedAmount(VestingSchedule memory _vestingSchedule)
        private
        view
        returns (uint256)
    {
        if (_vestingSchedule.totalAmount == 0) {
            return 0;
        }

        uint256 blockTimestamp = (block.timestamp);

        if (blockTimestamp < _vestingSchedule.cliffInSeconds) {
            return 0;
        }

        uint256 timeFromStart = blockTimestamp - _vestingSchedule.startAt;

        if (timeFromStart >= _vestingSchedule.durationInSeconds) {
            return _vestingSchedule.totalAmount - _vestingSchedule.released;
        }

        uint256 released = _vestingSchedule.released;

        if ((timeFromStart / 86400) % 30 != 0 && released == 0) {
            return _vestingSchedule.earlyUnlockAmount;
        }

        if ((timeFromStart / 86400) % 30 != 0 && released > 0) {
            return 0;
        }

        uint256 vestedAmountForPeriod = 0;

        if (released == 0) {
            return
                _vestingSchedule.earlyUnlockAmount +
                (_vestingSchedule.totalAmount * timeFromStart) /
                _vestingSchedule.durationInSeconds;
        } else {
            vestedAmountForPeriod +=
                (_vestingSchedule.totalAmount * timeFromStart) /
                _vestingSchedule.durationInSeconds -
                (released - _vestingSchedule.earlyUnlockAmount);

            if (
                released + vestedAmountForPeriod <= _vestingSchedule.totalAmount
            ) {
                return vestedAmountForPeriod;
            } else {
                return _vestingSchedule.totalAmount - released;
            }
        }
    }
}
