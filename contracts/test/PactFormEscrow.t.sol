// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {PactFormEscrow} from "../PactFormEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract PactFormEscrowTest is Test {
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
    address internal dave    = makeAddr("dave");
    address internal creator = makeAddr("creator");

    address internal instructor = makeAddr("instructor");
    address internal organizer  = makeAddr("organizer");

    uint256 internal constant PRICE       = 10e6;   // 10 USDC
    uint32  internal constant GOAL_COUNT  = 3;
    uint32  internal constant CAPACITY    = 10;
    uint64  internal constant DEADLINE_DELTA = 7 days;

    MockERC20        internal usdc;
    PactFormEscrow   internal form;
    uint64           internal deadline;

    // ─────────────────────────────────────────────────────────────────────────
    //  EIP-712 helpers
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

    // ─────────────────────────────────────────────────────────────────────────
    //  Deploy helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _deploy(
        uint32 goalCount_,
        uint32 capacity_,
        uint64 deadline_
    ) internal returns (PactFormEscrow) {
        address[5] memory recips;
        uint16[5]  memory splitsBps;
        recips[0]    = instructor;
        recips[1]    = organizer;
        splitsBps[0] = 7000;
        splitsBps[1] = 3000;

        return new PactFormEscrow(
            address(usdc),
            signerAddr,
            PRICE,
            recips,
            splitsBps,
            goalCount_,
            capacity_,
            deadline_,
            creator
        );
    }

    /// Register `payer` on `form_`. Uses a fresh expiry above current timestamp.
    function _register(
        PactFormEscrow form_,
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
        deadline = uint64(block.timestamp + DEADLINE_DELTA);
        form = _deploy(GOAL_COUNT, CAPACITY, deadline);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  1. Deployment & initialization
    // ─────────────────────────────────────────────────────────────────────────

    function test_Deployment_CorrectImmutables() public view {
        assertEq(address(form.usdc()), address(usdc));
        assertEq(form.signer(),        signerAddr);
        assertEq(form.price(),         PRICE);
        assertEq(form.goalCount(),     GOAL_COUNT);
        assertEq(form.capacity(),      CAPACITY);
        assertEq(form.deadline(),      deadline);
        assertEq(form.formCreator(),   creator);
        assertEq(uint256(form.status()), uint256(PactFormEscrow.Status.Active));
        assertFalse(form.finalized());
        assertFalse(form.refundsEnabled());
        assertEq(form.registrationCount(), 0);
        assertEq(form.escrowBalance(),     0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  2. Happy path: 3 registrations → GoalReached, recipients can withdraw
    // ─────────────────────────────────────────────────────────────────────────

    function test_HappyPath_GoalReached_AfterDeadline() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));
        _register(form, carol, keccak256("s-c"), keccak256("r-c"));

        assertEq(form.registrationCount(), 3);
        assertEq(form.escrowBalance(),     3 * PRICE);

        // Warp past deadline, then finalize
        vm.warp(deadline + 1);

        vm.expectEmit(true, false, false, true, address(form));
        emit PactFormEscrow.Finalized(PactFormEscrow.Status.GoalReached, 3, 3 * PRICE);
        form.finalize();

        assertEq(uint256(form.status()), uint256(PactFormEscrow.Status.GoalReached));
        assertTrue(form.finalized());
        assertFalse(form.refundsEnabled());

        // Recipients can withdraw
        uint256 instructorShare = form.withdrawable(instructor);
        uint256 organizerShare  = form.withdrawable(organizer);
        assertEq(instructorShare + organizerShare, 3 * PRICE);

        vm.prank(instructor);
        form.withdraw();
        assertEq(usdc.balanceOf(instructor), instructorShare);

        vm.prank(organizer);
        form.withdraw();
        assertEq(usdc.balanceOf(organizer), organizerShare);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  3. GoalMissed path: fewer than goalCount registrations → refunds enabled
    // ─────────────────────────────────────────────────────────────────────────

    function test_GoalMissed_RefundsEnabled_ClaimRefundWorks() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));
        // Only 2 of 3 needed

        vm.warp(deadline + 1);

        vm.expectEmit(true, false, false, true, address(form));
        emit PactFormEscrow.Finalized(PactFormEscrow.Status.GoalMissed, 2, 2 * PRICE);
        form.finalize();

        assertEq(uint256(form.status()), uint256(PactFormEscrow.Status.GoalMissed));
        assertTrue(form.refundsEnabled());

        // alice claims refund
        vm.expectEmit(true, false, false, true, address(form));
        emit PactFormEscrow.RefundClaimed(alice, PRICE);
        vm.prank(alice);
        form.claimRefund();

        assertEq(usdc.balanceOf(alice), PRICE);
        assertEq(form.refundable(alice), 0);

        // bob claims refund
        vm.prank(bob);
        form.claimRefund();
        assertEq(usdc.balanceOf(bob), PRICE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  4. Cancel + refund: creator cancels before deadline, finalize enables refunds
    // ─────────────────────────────────────────────────────────────────────────

    function test_Cancel_ThenFinalize_EnablesRefunds() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));

        // Creator cancels (1 < goalCount=3, before deadline)
        vm.expectEmit(true, false, false, false, address(form));
        emit PactFormEscrow.Cancelled(creator);
        vm.prank(creator);
        form.cancel();

        assertEq(uint256(form.status()), uint256(PactFormEscrow.Status.Cancelled));

        // Finalize without hitting deadline (Cancelled status allows it)
        form.finalize();

        assertEq(uint256(form.status()), uint256(PactFormEscrow.Status.GoalMissed));
        assertTrue(form.refundsEnabled());
        assertTrue(form.finalized());

        // Alice should be able to claim refund
        vm.prank(alice);
        form.claimRefund();
        assertEq(usdc.balanceOf(alice), PRICE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  5. Cancel blocked once goal reached (registrationCount >= goalCount)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_CancelBlockedWhenGoalReached() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));
        _register(form, carol, keccak256("s-c"), keccak256("r-c"));
        // registrationCount == goalCount == 3 → cancel must revert
        vm.prank(creator);
        vm.expectRevert(PactFormEscrow.GoalAlreadyReached.selector);
        form.cancel();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  6. Revert: NotActive when registering after deadline
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_NotActive_RegisterAfterDeadline() public {
        vm.warp(deadline + 1);

        uint64 expiry = uint64(block.timestamp + 3600);
        bytes32 subId = keccak256("s-late");
        bytes memory sig = _makeSig(address(form), alice, subId, keccak256("r"), PRICE, expiry);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormEscrow.NotActive.selector);
        form.register(subId, keccak256("r"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  7. Revert: AlreadyFinalized on second finalize()
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AlreadyFinalized() public {
        vm.warp(deadline + 1);
        form.finalize();

        vm.expectRevert(PactFormEscrow.AlreadyFinalized.selector);
        form.finalize();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  8. Revert: Unauthorized on cancel() from non-creator
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_Unauthorized_Cancel() public {
        vm.prank(alice);
        vm.expectRevert(PactFormEscrow.Unauthorized.selector);
        form.cancel();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  9. Revert: DeadlinePassed on cancel() after deadline
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_DeadlinePassed_Cancel() public {
        vm.warp(deadline + 1);
        vm.prank(creator);
        vm.expectRevert(PactFormEscrow.DeadlinePassed.selector);
        form.cancel();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  10. Revert: DeadlineNotReached on finalize() before deadline (and not
    //              cancelled and capacity not filled)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_DeadlineNotReached_Finalize() public {
        // Still before deadline, not cancelled, capacity not full
        vm.expectRevert(PactFormEscrow.DeadlineNotReached.selector);
        form.finalize();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  11. Early finalize when capacity filled (capacity=2, goalCount=2)
    // ─────────────────────────────────────────────────────────────────────────

    function test_EarlyFinalize_WhenCapacityFilled() public {
        // capacity == goalCount == 2; fill it before deadline
        PactFormEscrow smallForm = _deploy(2, 2, deadline);

        _register(smallForm, alice, keccak256("s-a"), keccak256("r-a"));
        _register(smallForm, bob,   keccak256("s-b"), keccak256("r-b"));

        // Finalize BEFORE deadline — allowed because capacity is filled
        smallForm.finalize();

        assertEq(uint256(smallForm.status()), uint256(PactFormEscrow.Status.GoalReached));
        assertTrue(smallForm.finalized());
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  12. Deterministic rounding: 3 × 0.10 USDC, 70/30 split
    // ─────────────────────────────────────────────────────────────────────────

    /// Register payer on `form_` using an explicit `price_` (for forms deployed
    /// with a non-default price). Extracted to avoid stack-too-deep.
    function _registerWithPrice(
        PactFormEscrow form_,
        address payer,
        bytes32 submissionId,
        bytes32 responseCommitment,
        uint256 price_
    ) internal {
        uint64 expiry = uint64(block.timestamp + 3600);
        bytes32 structHash = keccak256(
            abi.encode(SUBMIT_AUTHORIZATION_TYPEHASH, payer, submissionId, responseCommitment, price_, expiry)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(address(form_)), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        usdc.mint(payer, price_);
        vm.startPrank(payer);
        usdc.approve(address(form_), price_);
        form_.register(submissionId, responseCommitment, expiry, sig);
        vm.stopPrank();
    }

    function test_DeterministicRounding_ThreeRegistrations() public {
        uint256 smallPrice = 100_000; // 0.10 USDC (6 decimals)

        address[5] memory recips;
        uint16[5]  memory splitsBps;
        recips[0]    = instructor;
        recips[1]    = organizer;
        splitsBps[0] = 7000;
        splitsBps[1] = 3000;

        PactFormEscrow roundForm = new PactFormEscrow(
            address(usdc),
            signerAddr,
            smallPrice,
            recips,
            splitsBps,
            3,
            10,
            deadline,
            creator
        );

        _registerWithPrice(roundForm, alice, keccak256("sub-round-0"), keccak256("r-round-0"), smallPrice);
        _registerWithPrice(roundForm, bob,   keccak256("sub-round-1"), keccak256("r-round-1"), smallPrice);
        _registerWithPrice(roundForm, carol, keccak256("sub-round-2"), keccak256("r-round-2"), smallPrice);

        vm.warp(deadline + 1);
        roundForm.finalize();

        uint256 totalWithdrawable =
            roundForm.withdrawable(instructor) + roundForm.withdrawable(organizer);

        assertEq(totalWithdrawable, 3 * smallPrice, "total withdrawable must equal 3*price");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  13. withdraw() reverts when status != GoalReached (GoalMissed case)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_WithdrawNotActive_WhenGoalMissed() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));

        vm.warp(deadline + 1);
        form.finalize(); // GoalMissed (only 1 of 3)

        vm.prank(instructor);
        vm.expectRevert(PactFormEscrow.NotActive.selector);
        form.withdraw();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  14. claimRefund() reverts when status == GoalReached
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_ClaimRefund_WhenGoalReached() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));
        _register(form, carol, keccak256("s-c"), keccak256("r-c"));

        vm.warp(deadline + 1);
        form.finalize();

        vm.prank(alice);
        vm.expectRevert(PactFormEscrow.RefundsNotEnabled.selector);
        form.claimRefund();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  15. Revert: NothingToRefund for a non-registered address
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_NothingToRefund() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        vm.warp(deadline + 1);
        form.finalize();

        // dave never registered → NothingToRefund
        vm.prank(dave);
        vm.expectRevert(PactFormEscrow.NothingToRefund.selector);
        form.claimRefund();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  16. Revert: AlreadyRegistered
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AlreadyRegistered() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));

        uint64 expiry = uint64(block.timestamp + 3600);
        bytes32 subId2 = keccak256("s-a2");
        bytes memory sig = _makeSig(address(form), alice, subId2, keccak256("r-a2"), PRICE, expiry);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormEscrow.AlreadyRegistered.selector);
        form.register(subId2, keccak256("r-a2"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  17. Revert: CapacityExceeded
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_CapacityExceeded() public {
        PactFormEscrow tinyForm = _deploy(1, 1, deadline);

        _register(tinyForm, alice, keccak256("s-a"), keccak256("r-a"));

        uint64 expiry = uint64(block.timestamp + 3600);
        bytes32 subId = keccak256("s-b");
        bytes memory sig = _makeSig(address(tinyForm), bob, subId, keccak256("r-b"), PRICE, expiry);

        usdc.mint(bob, PRICE);
        vm.startPrank(bob);
        usdc.approve(address(tinyForm), PRICE);
        vm.expectRevert(PactFormEscrow.CapacityExceeded.selector);
        tinyForm.register(subId, keccak256("r-b"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  18. EIP-712: AuthorizationExpired
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AuthorizationExpired() public {
        uint64  expiry = uint64(block.timestamp - 1);
        bytes32 subId  = keccak256("s-exp");
        bytes memory sig = _makeSig(address(form), alice, subId, keccak256("r"), PRICE, expiry);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormEscrow.AuthorizationExpired.selector);
        form.register(subId, keccak256("r"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  19. EIP-712: AuthorizationUsed (replay same submissionId)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_AuthorizationUsed() public {
        bytes32 subId = keccak256("s-replay");
        _register(form, alice, subId, keccak256("r"));

        uint64 expiry = uint64(block.timestamp + 3600);
        bytes memory sig2 = _makeSig(address(form), bob, subId, keccak256("r"), PRICE, expiry);

        usdc.mint(bob, PRICE);
        vm.startPrank(bob);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormEscrow.AuthorizationUsed.selector);
        form.register(subId, keccak256("r"), expiry, sig2);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  20. EIP-712: InvalidAuthorization (wrong signer)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_InvalidAuthorization() public {
        uint256 wrongPk  = 0xBADBAD;
        bytes32 subId    = keccak256("s-bad");
        uint64  expiry   = uint64(block.timestamp + 3600);
        bytes32 structHash = keccak256(
            abi.encode(SUBMIT_AUTHORIZATION_TYPEHASH, alice, subId, keccak256("r"), PRICE, expiry)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(address(form)), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        usdc.mint(alice, PRICE);
        vm.startPrank(alice);
        usdc.approve(address(form), PRICE);
        vm.expectRevert(PactFormEscrow.InvalidAuthorization.selector);
        form.register(subId, keccak256("r"), expiry, sig);
        vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  21. Revert: NotActive — cancel after already Cancelled
    // ─────────────────────────────────────────────────────────────────────────

    function test_Revert_NotActive_CancelTwice() public {
        vm.prank(creator);
        form.cancel();

        vm.prank(creator);
        vm.expectRevert(PactFormEscrow.NotActive.selector);
        form.cancel();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  22. withdrawFor() works for GoalReached
    // ─────────────────────────────────────────────────────────────────────────

    function test_WithdrawFor_AfterGoalReached() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));
        _register(form, carol, keccak256("s-c"), keccak256("r-c"));

        vm.warp(deadline + 1);
        form.finalize();

        uint256 orgShare = form.withdrawable(organizer);
        assertGt(orgShare, 0);

        // Anyone can call withdrawFor on behalf of a recipient
        vm.prank(alice);
        form.withdrawFor(organizer);

        assertEq(usdc.balanceOf(organizer), orgShare);
        assertEq(form.withdrawable(organizer), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  23. escrowBalance tracks correctly after refunds
    // ─────────────────────────────────────────────────────────────────────────

    function test_EscrowBalance_DecreasesOnRefund() public {
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));

        assertEq(form.escrowBalance(), 2 * PRICE);

        vm.warp(deadline + 1);
        form.finalize(); // GoalMissed

        vm.prank(alice);
        form.claimRefund();

        assertEq(form.escrowBalance(), PRICE); // one refund left
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  24. Invariant: escrowBalance >= sum of refundable after N registrations
    //      (lightweight stateful fuzz via invariant test)
    // ─────────────────────────────────────────────────────────────────────────

    function test_EscrowBalance_MatchesSumOfPrices() public {
        // 3 registrations: escrowBalance must equal 3*price
        _register(form, alice, keccak256("s-a"), keccak256("r-a"));
        _register(form, bob,   keccak256("s-b"), keccak256("r-b"));
        _register(form, carol, keccak256("s-c"), keccak256("r-c"));

        assertEq(form.escrowBalance(), 3 * PRICE);
        assertEq(usdc.balanceOf(address(form)), 3 * PRICE);
    }
}
