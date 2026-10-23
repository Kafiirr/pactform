// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PactFormCollectSplit} from "../PactFormCollectSplit.sol";

/**
 * Parametric deploy of PactFormCollectSplit — all form parameters come from env vars.
 * Called by the PACTFORM backend at publish time via `forge script --broadcast`.
 *
 * Required env vars:
 *   PRIVATE_KEY           — deployer (formCreator) private key
 *   PACTFORM_SIGNER_ADDR  — backend EIP-712 signer address
 *   FORM_PRICE            — price in USDC atomic units (6 decimals), e.g. "100000"
 *   FORM_CAPACITY         — max registrations (0 = unlimited)
 *   FORM_RECIPIENT_0..4   — recipient addresses (use 0x000...0 for empty slots)
 *   FORM_SPLIT_0..4       — split basis points (must sum to 10000)
 */
contract DeployCollectSplitParam is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey  = vm.envUint("PRIVATE_KEY");
        // FORM_CREATOR is the connected user's address — they become the formCreator
        // in the contract (can withdraw, etc). The deployer key just pays gas.
        address formCreator_ = vm.envAddress("FORM_CREATOR");
        address signerAddr   = vm.envAddress("PACTFORM_SIGNER_ADDR");
        uint256 price_      = vm.envUint("FORM_PRICE");
        uint32  capacity_   = uint32(vm.envUint("FORM_CAPACITY"));

        address[5] memory recipients_;
        recipients_[0] = vm.envAddress("FORM_RECIPIENT_0");
        recipients_[1] = vm.envAddress("FORM_RECIPIENT_1");
        recipients_[2] = vm.envAddress("FORM_RECIPIENT_2");
        recipients_[3] = vm.envAddress("FORM_RECIPIENT_3");
        recipients_[4] = vm.envAddress("FORM_RECIPIENT_4");

        uint16[5] memory splits_;
        splits_[0] = uint16(vm.envUint("FORM_SPLIT_0"));
        splits_[1] = uint16(vm.envUint("FORM_SPLIT_1"));
        splits_[2] = uint16(vm.envUint("FORM_SPLIT_2"));
        splits_[3] = uint16(vm.envUint("FORM_SPLIT_3"));
        splits_[4] = uint16(vm.envUint("FORM_SPLIT_4"));

        vm.startBroadcast(deployerKey);

        PactFormCollectSplit cs = new PactFormCollectSplit(
            USDC,
            signerAddr,
            price_,
            recipients_,
            splits_,
            capacity_,
            formCreator_
        );

        vm.stopBroadcast();

        // Output exactly "DEPLOYED_ADDRESS=0x..." so the backend can parse it
        console.log("DEPLOYED_ADDRESS=%s", address(cs));
    }
}
