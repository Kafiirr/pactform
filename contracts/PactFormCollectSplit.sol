// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PactFormCollectSplit is ReentrancyGuard {
    error ZeroAddress();
    error InvalidPrice();
    error InvalidRecipients();
    error AlreadyRegistered();
    error CapacityExceeded();
    error AuthorizationExpired();
    error AuthorizationUsed();
    error InvalidAuthorization();
    error PriceMismatch();
    error NothingToWithdraw();
    error TransferFailed();

    event Registered(address indexed payer, bytes32 indexed submissionId, bytes32 responseCommitment, uint256 price);
    event Withdrawn(address indexed recipient, uint256 amount);

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SUBMIT_AUTHORIZATION_TYPEHASH =
        keccak256("SubmitAuthorization(address payer,bytes32 submissionId,bytes32 responseCommitment,uint256 price,uint64 expiry)");
    bytes32 private constant NAME_HASH = keccak256("Pactform");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable usdc;
    address public immutable signer;
    uint256 public immutable price;
    uint32 public immutable capacity;
    address public immutable formCreator;
    // Fork-safe EIP-712: cache both the separator and the chain ID it was built for.
    // _domainSeparatorV4() recomputes when block.chainid differs from the cached value.
    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;

    address[5] public recipients;
    uint16[5] public splits;

    mapping(address => bool) public registered;
    uint32 public registrationCount;
    mapping(address => uint256) public withdrawable;
    mapping(bytes32 => bool) public usedAuthorizations;

    constructor(
        address usdc_,
        address signer_,
        uint256 price_,
        address[5] memory recipients_,
        uint16[5] memory splits_,
        uint32 capacity_,
        address formCreator_
    ) {
        if (usdc_ == address(0) || signer_ == address(0) || formCreator_ == address(0)) revert ZeroAddress();
        if (price_ == 0) revert InvalidPrice();

        uint256 splitSum;
        bool hasRecipient;

        for (uint256 i = 0; i < 5; ++i) {
            address recipient = recipients_[i];
            uint16 split = splits_[i];

            recipients[i] = recipient;
            splits[i] = split;

            if (recipient == address(0)) {
                if (split != 0) revert InvalidRecipients();
                continue;
            }

            if (split == 0) revert InvalidRecipients();
            hasRecipient = true;
            splitSum += split;
        }

        if (!hasRecipient || splitSum != BPS_DENOMINATOR) revert InvalidRecipients();

        usdc = IERC20(usdc_);
        signer = signer_;
        price = price_;
        capacity = capacity_;
        formCreator = formCreator_;

        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function _domainSeparatorV4() internal view returns (bytes32) {
        if (block.chainid == _cachedChainId) return _cachedDomainSeparator;
        return _buildDomainSeparator();
    }

    function register(
        bytes32 submissionId,
        bytes32 responseCommitment,
        uint64 authExpiry,
        bytes calldata authSignature
    ) external nonReentrant {
        address payer = msg.sender;

        if (registered[payer]) revert AlreadyRegistered();
        if (capacity != 0 && registrationCount >= capacity) revert CapacityExceeded();

        _verifyAuthorization(payer, submissionId, responseCommitment, authExpiry, authSignature);
        usedAuthorizations[submissionId] = true;

        if (!usdc.transferFrom(payer, address(this), price)) revert TransferFailed();

        _creditRecipients(price);

        registered[payer] = true;
        unchecked {
            registrationCount += 1;
        }

        emit Registered(payer, submissionId, responseCommitment, price);
    }

    function withdraw() external nonReentrant {
        _withdrawFor(msg.sender);
    }

    function withdrawFor(address recipient) external nonReentrant {
        _withdrawFor(recipient);
    }

    function _withdrawFor(address recipient) internal {
        uint256 amount = withdrawable[recipient];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[recipient] = 0;
        if (!usdc.transfer(recipient, amount)) revert TransferFailed();

        emit Withdrawn(recipient, amount);
    }

    function _creditRecipients(uint256 amountIn) internal {
        uint256 remaining = amountIn;
        uint256 remainingBps = BPS_DENOMINATOR;

        for (uint256 i = 0; i < 5; ++i) {
            uint16 split = splits[i];
            if (split == 0) continue;

            address recipient = recipients[i];
            uint256 share;

            if (split == remainingBps) {
                share = remaining;
            } else {
                share = (amountIn * split) / BPS_DENOMINATOR;
            }

            withdrawable[recipient] += share;
            remaining -= share;
            remainingBps -= split;
        }
    }

    function _verifyAuthorization(
        address payer,
        bytes32 submissionId,
        bytes32 responseCommitment,
        uint64 authExpiry,
        bytes calldata authSignature
    ) internal view {
        if (block.timestamp > authExpiry) revert AuthorizationExpired();
        if (usedAuthorizations[submissionId]) revert AuthorizationUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_AUTHORIZATION_TYPEHASH,
                payer,
                submissionId,
                responseCommitment,
                price,
                authExpiry
            )
        );

        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparatorV4(), structHash);
        address recoveredSigner = ECDSA.recover(digest, authSignature);

        if (recoveredSigner != signer) revert InvalidAuthorization();
    }
}
