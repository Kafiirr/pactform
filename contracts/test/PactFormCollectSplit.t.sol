// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {PactFormCollectSplit} from "../PactFormCollectSplit.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract PactFormCollectSplitTest is Test {
    // ─────────────────────────────────────────────────────────────────────────
    //  EIP-712 constants (mirrored from the contract)
    // ─────────────────────────────────────────────────────────────────────────
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SUBMIT_AUTHORIZATION_TYPEHASH =
        keccak256("SubmitAuthorization(address payer,bytes32 submissionId,bytes32 responseCommitment,uint256 price,uint64 expiry)");
    bytes32 private constant NAME_HASH    = keccak256("Pactform");
    bytes32 private constant VERSION_HASH = keccak256("1");

    // ─────────────────────────────────────────────────────────────────────────
    //  Actors & constants
    // ─────────────────────────────────────────────────────────────────────────
    uint256 internal constant SIGNER_PK = 0xA11CE;
    address internal signerAddr;

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal creator = makeAddr("creator");

    address internal instructor = makeAddr("instructor");
    address internal organizer  = makeAddr("organizer");

    uint256 internal constant PRICE    = 10e6; // 10 USDC
    uint32  internal constant CAPACITY = 10;

    MockERC20             internal usdc;
    PactFormCollectSplit  internal form;

    // ─────────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _domainSeparator(address contractAddr) internal view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, contractAddr)
        );
    }

    function _makeSig(
        address contractAddr,
        address payer,
        bytes32 submissionId,
        bytes32 responseCommitment,
        uint256 price_,
        uint64  expiry
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                SUBMIT_AUTHORIZATION_TYPEHASH,
                payer,
                submissionId,
                responseCommitment,
                price_,
                expiry
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(contractAddr), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Deploy a fresh form with a 70/30 split between instructor and organizer.
    function _deploy(uint32 capacity_) internal returns (PactFormCollectSplit) {
        address[5] memory recips;
        uint16[5]  memory splitsBps;
        recips[0]    = instructor;
        recips[1]    = organizer;
        splitsBps[0] = 7000;
        splitsBps[1] = 3000;

        return new PactFormCollectSplit(
            address(usdc),
            signerAddr,
            PRICE,
            recips,
            splitsBps,
            capacity_,
            creator
        );
    }

    /// Register payer, generating a fresh submissionId and unique expiry slot.
    function _register(
        PactFormCollectSplit form_,
        address payer,
        bytes32 submissionId,
        bytes32 responseCommitment
    ) internal {
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig = _makeSig(
            address(form_), payer, submissionId, responseCommitment, PRICE, expiry
        );

        usdc.mint(payer, PRICE);
        vm.startPrank(payer);
        usdc.approve(address(form_), PRICE);
        form_.register(submissionId, responseCommitment, expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  setUp
    // ─────────────────────────────────────────────────────────────────────────

    function setUp() public {
        signerAddr = vm.addr(SIGNER_PK);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        form = _deploy(CAPACITY);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  1. Deployment & initialization
    // ─────────────────────────────────────────────────────────────────────────

    function test_Deployment_CorrectImmutables() public view {
        assertEq(address(form.usdc()),  address(usdc));
        assertEq(form.signer(),         signerAddr);
        assertEq(form.price(),          PRICE);
        assertEq(form.capacity(),       CAPACITY);
        assertEq(form.formCreator(),    creator);
        assertEq(form.registrationCount(), 0);
    }

    function test_Deployment_SplitsStored() public view {
        assertEq(form.recipients(0), instructor);
        assertEq(form.recipients(1), organizer);
        assertEq(form.splits(0), 7000);
        assertEq(form.splits(1), 3000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  2. Happy-path: register + Registered event emitted + withdrawable credited
    // ─────────────────────────────────────────────────────────────────────────

    function test_Register_HappyPath_EmitsAndCredits() public {
        bytes32 subId    = keccak256("sub-alice");
        bytes32 respComm = keccak256("resp-alice");
        uint64  expiry   = uint64(block.timestamp + 3600);

        bytes memory sig = _makeSig(address(form), alice, subId, respComm, PRICE, expiry);
        usdc.mint(alice, PRICE);

        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);

        vm.expectEmit(true, true, false, true, address(form));
        emit PactFormCollectSplit.Registered(alice, subId, respComm, PRICE);
        form.register(subId, respComm, expiry, sig);
        vm.stopPrank();

        assertEq(form.registrationCount(), 1);
        assertTrue(form.registered(alice));
        assertEq(form.withdrawable(instructor), (PRICE * 7000) / 10_000);
        assertEq(form.withdrawable(organizer),  PRICE - (PRICE * 7000) / 10_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  3. Rounding: 3 registrations, 70/30 split — total credited == 3*price
    // ─────────────────────────────────────────────────────────────────────────

    function test_Register_3xRounding_TotalCredited() public {
        _register(form, alice, keccak256("sub-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("sub-b"), keccak256("r-b"));
        _register(form, carol, keccak256("sub-c"), keccak256("r-c"));

        uint256 totalWithdrawable =
            form.withdrawable(instructor) + form.withdrawable(organizer);

        assertEq(totalWithdrawable, 3 * PRICE, "total withdrawable must equal 3*price");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  4. withdraw(): recipient pulls their share — Withdrawn event, balance zeroed
    // ─────────────────────────────────────────────────────────────────────────

    function test_Withdraw_RecipientPullsShare() public {
        _register(form, alice, keccak256("sub-a"), keccak256("r-a"));

        uint256 expectedShare = form.withdrawable(instructor);
        assertGt(expectedShare, 0);

        vm.expectEmit(true, false, false, true, address(form));
        emit PactFormCollectSplit.Withdrawn(instructor, expectedShare);

        vm.prank(instructor);
        form.withdraw();

        assertEq(form.withdrawable(instructor), 0);
        assertEq(usdc.balanceOf(instructor), expectedShare);
    }

    function test_WithdrawFor_NonSelfPull() public {
        _register(form, alice, keccak256("sub-a"), keccak256("r-a"));

        uint256 expectedShare = form.withdrawable(organizer);
        assertGt(expectedShare, 0);

        // Anyone can call withdrawFor on behalf of a recipient
        vm.prank(alice);
        form.withdrawFor(organizer);

        assertEq(form.withdrawable(organizer), 0);
        assertEq(usdc.balanceOf(organizer), expectedShare);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  5. Revert: NothingToWithdraw
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_NothingToWithdraw() public {
        vm.prank(instructor);
        vm.expectRevert(PactFormCollectSplit.NothingToWithdraw.selector);
        form.withdraw();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  6. Revert: AlreadyRegistered
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AlreadyRegistered() public {
        _register(form, alice, keccak256("sub-a"), keccak256("r-a"));

        uint64 expiry = uint64(block.timestamp + 3600);
        bytes32 subId2 = keccak256("sub-a2");
        bytes memory sig = _makeSig(address(form), alice, subId2, keccak256("r-a2"), PRICE, expiry);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormCollectSplit.AlreadyRegistered.selector);
        form.register(subId2, keccak256("r-a2"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  7. Revert: CapacityExceeded
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_CapacityExceeded() public {
        // Deploy with capacity=1
        PactFormCollectSplit smallForm = _deploy(1);

        _register(smallForm, alice, keccak256("sub-a"), keccak256("r-a"));

        // bob tries to register → CapacityExceeded
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes32 subId = keccak256("sub-b");
        bytes memory sig = _makeSig(address(smallForm), bob, subId, keccak256("r-b"), PRICE, expiry);

        usdc.mint(bob, PRICE);
        vm.startPrank(bob);
        usdc.approve(address(smallForm), PRICE);
        vm.expectRevert(PactFormCollectSplit.CapacityExceeded.selector);
        smallForm.register(subId, keccak256("r-b"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  8. Revert: AuthorizationExpired
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AuthorizationExpired() public {
        uint64 expiry = uint64(block.timestamp - 1); // already in the past
        bytes32 subId = keccak256("sub-expired");
        bytes memory sig = _makeSig(address(form), alice, subId, keccak256("r"), PRICE, expiry);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormCollectSplit.AuthorizationExpired.selector);
        form.register(subId, keccak256("r"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  9. Revert: AuthorizationUsed (replay same submissionId)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AuthorizationUsed() public {
        bytes32 subId    = keccak256("sub-replay");
        bytes32 respComm = keccak256("r");
        uint64  expiry   = uint64(block.timestamp + 3600);

        // alice registers successfully
        bytes memory sig = _makeSig(address(form), alice, subId, respComm, PRICE, expiry);
        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        form.register(subId, respComm, expiry, sig);
        vm.stopPrank();

        // bob tries to reuse alice's submissionId with a fresh sig for bob
        bytes memory sig2 = _makeSig(address(form), bob, subId, respComm, PRICE, expiry);
        usdc.mint(bob, PRICE);
        vm.startPrank(bob);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormCollectSplit.AuthorizationUsed.selector);
        form.register(subId, respComm, expiry, sig2);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  10. Revert: InvalidAuthorization (wrong signer key)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_InvalidAuthorization() public {
        uint256 wrongPk  = 0xBADBAD;
        bytes32 subId    = keccak256("sub-bad");
        bytes32 respComm = keccak256("r");
        uint64  expiry   = uint64(block.timestamp + 3600);

        // Build sig with wrong private key
        bytes32 structHash = keccak256(
            abi.encode(SUBMIT_AUTHORIZATION_TYPEHASH, alice, subId, respComm, PRICE, expiry)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(address(form)), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormCollectSplit.InvalidAuthorization.selector);
        form.register(subId, respComm, expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  11. Fuzz: random split arrays summing to 10 000, total credited == price
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev We fuzz two split values (a, b) and fix the other three slots at 0
    ///      so that splits[0]=a, splits[1]=(10000-a) — always sums to 10 000.
    ///      Then we register once and check total withdrawable == price.
    function testFuzz_SplitRounding_TotalEqualsPrice(uint16 splitA) public {
        // Force splitA into [1, 9999] so both sides are non-zero
        splitA = uint16(bound(uint256(splitA), 1, 9999));
        uint16 splitB = 10_000 - splitA;

        address[5] memory recips;
        uint16[5]  memory splitsBps;
        recips[0]    = instructor;
        recips[1]    = organizer;
        splitsBps[0] = splitA;
        splitsBps[1] = splitB;

        PactFormCollectSplit fuzzForm = new PactFormCollectSplit(
            address(usdc),
            signerAddr,
            PRICE,
            recips,
            splitsBps,
            0, // unlimited capacity
            creator
        );

        _register(fuzzForm, alice, keccak256("sub-fuzz"), keccak256("r-fuzz"));

        uint256 total = fuzzForm.withdrawable(instructor) + fuzzForm.withdrawable(organizer);
        assertEq(total, PRICE, "total withdrawable must equal price for any valid split");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  12. Capacity = 0 means unlimited
    // ─────────────────────────────────────────────────────────────────────────

    function test_Capacity_ZeroIsUnlimited() public {
        PactFormCollectSplit unlimitedForm = _deploy(0);
        for (uint256 i = 0; i < 5; i++) {
            address payer = makeAddr(string(abi.encodePacked("payer", i)));
            _register(unlimitedForm, payer, keccak256(abi.encodePacked("sub", i)), keccak256(abi.encodePacked("r", i)));
        }
        assertEq(unlimitedForm.registrationCount(), 5);
    }
}
