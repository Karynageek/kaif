// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "./interface/ITokenVesting.sol";
import "./Token.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract Vesting is AccessControl, ITokenVesting, ReentrancyGuard {
    using SafeERC20 for Token;

    bytes32 public constant MULTISIG_ROLE = keccak256("MULTISIG_ROLE");
    bytes32 public constant STARTER_ROLE = keccak256("STARTER_ROLE");

    Token public immutable token;

    uint256 public startAt;

    uint8 public constant DIRECTION_COUNT = 5;
    uint8 public constant MULTISIG_REQUIRED_COUNT = 3;

    uint256 public vestingSchedulesTotalAmount;

    enum Direction {
        SEED_ROUND,
        PRIVATE_ROUND_ONE,
        PRIVATE_ROUND_TWO,
        MARKETING,
        TEAM,
        FOUNDATION
    }

    struct VestingSchedule {
        uint256 cliffInSeconds;
        uint256 startAt;
        uint256 durationInSeconds;
        uint256 totalAmount;
        uint256 released;
    }

    uint256 public foundersTotalAmount;
    mapping(address => uint256) foundersPercent;
    address[] founders;

    mapping(address => mapping(uint8 => VestingSchedule))
        public vestingSchedules;

    event Claimed(address account, uint256 amount);
    event VestingCreated(address account, uint256 amount, uint256 startAt);
    event BatchVestingCreated(
        address[] accounts,
        uint256[] amounts,
        uint256 startAt
    );

    constructor(address token_, address multisig_) {
        token = Token(token_);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MULTISIG_ROLE, multisig_);
        _grantRole(STARTER_ROLE, token_);
    }

    function setStartAt() external onlyRole(STARTER_ROLE) {
        startAt = block.timestamp;
    }

    function setSeedRoundVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            360 days,
            960 days,
            uint8(Direction.SEED_ROUND)
        );
    }

    function setPrivateRoundOneVestingSchedule(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            180 days,
            720 days,
            uint8(Direction.PRIVATE_ROUND_ONE)
        );
    }

    function setPrivateRoundTwoVestingSchedule(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            180 days,
            720 days,
            uint8(Direction.PRIVATE_ROUND_TWO)
        );
    }

    function setMarketingVestingSchedule(
        address _account,
        uint256 _amount,
        uint256 _cliff,
        uint256 _duration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _vestFor(
            _account,
            _amount,
            block.timestamp,
            _cliff,
            _duration,
            uint8(Direction.MARKETING)
        );

        emit VestingCreated(_account, _amount, block.timestamp);
    }

    function setBaseTeamVestingScheduleByAdmin(
        address[] calldata _accounts,
        uint256[] calldata _amounts,
        uint256[] calldata _percents
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            _accounts.length == _amounts.length &&
                _amounts.length == _percents.length,
            "Vesting: data lengths not match"
        );

        require(
            founders.length + _accounts.length == MULTISIG_REQUIRED_COUNT,
            "Vesting: count of founders shoud be 3"
        );

        uint256 totalPercent;

        for (uint256 i = 0; i < _accounts.length; i++) {
            _vestFor(
                _accounts[i],
                _amounts[i],
                startAt,
                120 days,
                720 days,
                uint8(Direction.TEAM)
            );

            totalPercent += _percents[i];
            foundersPercent[_accounts[i]] = _percents[i];
            founders.push(_accounts[i]);
            foundersTotalAmount += _amounts[i];
        }

        require(totalPercent == 100, "Vesting: total percent not 100");

        emit BatchVestingCreated(_accounts, _amounts, startAt);
    }

    function setTeamVestingScheduleByFounder(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(MULTISIG_ROLE) {
        require(
            _accounts.length == _amounts.length,
            "Vesting: accounts and amounts lengths not match"
        );

        require(
            founders.length == MULTISIG_REQUIRED_COUNT,
            "Vesting: count of founders shoud be 3"
        );

        uint256 teamTotalAmount;
        uint8 direction = uint8(Direction.TEAM);

        for (uint256 i = 0; i < _accounts.length; i++) {
            teamTotalAmount += _amounts[i];

            require(
                (teamTotalAmount * 100) / foundersTotalAmount <= 50,
                "Vesting: max total amount for team can be 50%"
            );

            _vestFor(
                _accounts[i],
                _amounts[i],
                startAt,
                120 days,
                720 days,
                direction
            );
        }

        for (uint256 i = 0; i < founders.length; i++) {
            vestingSchedules[founders[i]][direction].totalAmount -=
                (teamTotalAmount * foundersPercent[founders[i]]) /
                100;
        }

        emit BatchVestingCreated(_accounts, _amounts, startAt);
    }

    function setFoundationVestingSchedule(
        address[] calldata _accounts,
        uint256[] calldata _amounts
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _batchVestFor(
            _accounts,
            _amounts,
            startAt,
            0,
            570 days,
            uint8(Direction.FOUNDATION)
        );
    }

    function withdraw(uint256 amount)
        public
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            getWithdrawableAmount() >= amount,
            "Vesting: not enough withdrawable funds"
        );

        token.safeTransfer(msg.sender, amount);
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

        require(totalVestedAmount > 0, "Vesting: claim amount must be > 0");

        vestingSchedulesTotalAmount -= totalVestedAmount;

        token.safeTransfer(msg.sender, totalVestedAmount);

        emit Claimed(msg.sender, totalVestedAmount);
    }

    function getVestedAmount(address _account)
        external
        view
        returns (uint256 totalVestedAmount)
    {
        for (uint8 i = 0; i < DIRECTION_COUNT; i++) {
            uint256 vestedAmount = _vestedAmount(vestingSchedules[_account][i]);

            totalVestedAmount += vestedAmount;
        }
    }

    function getVestedSchedule(address _account, uint8 _direction)
        external
        view
        returns (VestingSchedule memory)
    {
        return vestingSchedules[_account][_direction];
    }

    function getWithdrawableAmount() public view returns (uint256) {
        return token.balanceOf(address(this)) - vestingSchedulesTotalAmount;
    }

    function getVestingSchedulesTotalAmount() external view returns (uint256) {
        return vestingSchedulesTotalAmount;
    }

    function _batchVestFor(
        address[] calldata _accounts,
        uint256[] calldata _amounts,
        uint256 _startAt,
        uint256 _cliff,
        uint256 _duration,
        uint8 _direction
    ) private {
        require(
            _accounts.length == _amounts.length,
            "Vesting: accounts and amounts lengths not match"
        );

        for (uint256 i = 0; i < _accounts.length; i++) {
            _vestFor(
                _accounts[i],
                _amounts[i],
                _startAt,
                _cliff,
                _duration,
                _direction
            );
        }

        emit BatchVestingCreated(_accounts, _amounts, _startAt);
    }

    function _vestFor(
        address _account,
        uint256 _amount,
        uint256 _startAt,
        uint256 _cliff,
        uint256 _duration,
        uint8 _direction
    ) private {
        uint256 withdrawAmount = getWithdrawableAmount();

        require(withdrawAmount >= _amount, "Vesting: not sufficient tokens");
        require(_amount != 0, "Vesting: incorrect amount");
        require(_duration != 0, "Vesting: duration must be > 0");
        require(_account != address(0), "Vesting: zero vester address");
        require(_startAt != 0, "Vesting: not started");

        vestingSchedulesTotalAmount += _amount;

        uint256 cliff = _startAt + _cliff;

        vestingSchedules[_account][_direction] = VestingSchedule(
            cliff,
            _startAt,
            _duration,
            _amount,
            0
        );
    }

    function _vestedAmount(VestingSchedule memory _vestingSchedule)
        private
        view
        returns (uint256)
    {
        uint256 blockTimestamp = block.timestamp;

        if (blockTimestamp < _vestingSchedule.cliffInSeconds) {
            return 0;
        }

        uint256 timeFromStart = blockTimestamp - _vestingSchedule.startAt;

        if (timeFromStart % 30 days != 1) {
            return 0;
        }

        if (timeFromStart >= _vestingSchedule.durationInSeconds) {
            return _vestingSchedule.totalAmount - _vestingSchedule.released;
        } else {
            return
                (_vestingSchedule.totalAmount * timeFromStart) /
                _vestingSchedule.durationInSeconds -
                _vestingSchedule.released;
        }
    }
}

//промежуток времени, начало и конец
//время%остаток от деления (месяц) меньше, чем 1 сут
//разлог раз в месяц(30 days)

//Multisig после добавления 3 адресов founders, доля в тиме 10-40-50. Подпись мультисигом 3 из 3. Их доли
//пересчитываются. Каждый может вывести свои токены без подтверждения остальных.
//120 млн всего. Максимум для дополнительных членов 60 млн, 50% - 10-40-50
//Заранее будут указаны кошельки, на которые мы отправляем токены и их количество.
//------------
// Если  требуется добавить новый кошелек - требуется мультиподпись.
// В Team будут три воллета 10%, 40% и 50%
// 	Принцип три из трех - мультиподпись - могут добавлять новых участников.
//И какое количество токенов они получат?
// Когда они кому-то выдают количество токенов, их доли перераспределяются.
// Каждый из них может вывести свои токены в любой момент времени согласно вестингу, без подписи других участников.
// Из остаточного пула могут получить свою награду в пропорции.
// Максимум токенов, которые можно выделить на дополнительных участников, равен 60 млн. (50%). Остальные токены все равно делятся в пропорции 10%\40%\50%.

//отдельный контракт, создать роль чтоб добавить мул.
//передать кол дату в мультисиг(адрес, кол дату, массивы врс; делать рекавер)мапинг адрес бул, добавлять, удалять, редактировать участника. Потерял свой кошелек. Чтоб поменять нужно 3 или тока 2.
//нонсы проверять, 2 одинаковые подписи
