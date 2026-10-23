// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PactFormEscrow} from "../PactFormEscrow.sol";

/**
 * Deploy PactFormEscrow (demo workshop) from your own wallet.
 *
 * Required env vars:
 *   PRIVATE_KEY          — deployer / creator private key
 *   PACTFORM_SIGNER_ADDR — address whose key the backend uses to sign EIP-712 vouchers
 *
 * Demo params (hardcoded here, edit as needed):
 *   price      = 0.10 USDC
 *   goal       = 3 registrations
 *   deadline   = 2026-10-23 00:00:00 UTC  (unix 1792713600)
 *   splits     = 70% deployer (instructor) / 30% deployer (organizer) — same address for demo
 *   capacity   = 0 (unlimited)
 *
 * forge script contracts/script/DeployEscrow.s.sol \
 *   --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY
 */
contract DeployEscrow is Script {
    address constant USDC     = 0x3600000000000000000000000000000000000000;
    uint64  constant DEADLINE = 1792713600; // 2026-10-23 00:00:00 UTC

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address signerAddr  = vm.envAddress("PACTFORM_SIGNER_ADDR");

        // 70% instructor / 30% organizer — both point to deployer for demo
        address[5] memory recipients = [
            deployer, deployer,
            address(0), address(0), address(0)
        ];
        uint16[5] memory splits = [7000, 3000, 0, 0, 0];

        vm.startBroadcast(deployerKey);

        PactFormEscrow escrow = new PactFormEscrow(
            USDC,
            signerAddr,
            100_000,   // 0.10 USDC (6 decimals)
            recipients,
            splits,
            3,         // goalCount
            0,         // capacity = unlimited
            DEADLINE,
            deployer   // formCreator
        );

        vm.stopBroadcast();

        console.log("PactFormEscrow deployed at:", address(escrow));
        console.log("Deployer / formCreator:    ", deployer);
        console.log("Signer:                    ", signerAddr);
        console.log("Deadline (unix):           ", DEADLINE);
    }
}
