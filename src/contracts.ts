// PACTFORM contract ABIs and address helpers
// Addresses are read from environment, never hardcoded in source.

import collectSplitArtifact from '../contracts/out/PactFormCollectSplit.sol/PactFormCollectSplit.json'
import escrowArtifact from '../contracts/out/PactFormEscrow.sol/PactFormEscrow.json'
import { getUsdc } from '@/onchain-facts'
import { erc20Abi } from 'viem'

export const COLLECT_SPLIT_ABI = collectSplitArtifact.abi
export const ESCROW_ABI = escrowArtifact.abi

export const CHAIN_ID = 5042 // Arc Mainnet

export function getUsdcAddress(): `0x${string}` {
  const usdc = getUsdc(CHAIN_ID)
  if (!usdc) throw new Error('USDC not found for chain ' + CHAIN_ID)
  return usdc.address as `0x${string}`
}

export { erc20Abi }

// Demo deployed addresses from env
export const DEMO_ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS as `0x${string}` | undefined
export const DEMO_COLLECT_SPLIT_ADDRESS = import.meta.env.VITE_COLLECT_SPLIT_ADDRESS as `0x${string}` | undefined
