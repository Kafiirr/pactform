// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PactFormCollectSplit} from "../PactFormCollectSplit.sol";

/**
 * Deploy PactFormCollectSplit from your own wallet.
 *
 * Required env vars (set in .env or shell):
 *   PRIVATE_KEY          — deployer / creator private key
 *   PACTFORM_SIGNER_ADDR — address whose key the backend uses to sign EIP-712 vouchers
 *
 * Example (single-recipient, 100% split, no capacity cap):
 *   forge script contracts/script/DeployCollectSplit.s.sol \
 *     --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY
 */
contract DeployCollectSplit is Script {
    // Arc Testnet USDC ERC-20
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address signerAddr  = vm.envAddress("PACTFORM_SIGNER_ADDR");

        // Demo: single recipient = deployer, 100% split, 0.10 USDC, no cap
        address[5] memory recipients = [
            deployer,
            address(0), address(0), address(0), address(0)
        ];
        uint16[5] memory splits = [10000, 0, 0, 0, 0];

        vm.startBroadcast(deployerKey);

        PactFormCollectSplit cs = new PactFormCollectSplit(
            USDC,
            signerAddr,
            100_000,   // 0.10 USDC (6 decimals)
            recipients,
            splits,
            0,         // capacity = unlimited
            deployer   // formCreator
        );

        vm.stopBroadcast();

        console.log("PactFormCollectSplit deployed at:", address(cs));
        console.log("Deployer / formCreator:          ", deployer);
        console.log("Signer:                          ", signerAddr);
    }
}
