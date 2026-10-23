// PACTFORM contract ABIs and address helpers
// Addresses are read from environment, never hardcoded in source.

import { COLLECT_SPLIT_ABI as _CS_ABI, ESCROW_ABI as _ESC_ABI } from '@/contract-artifacts'
import { getUsdc } from '@/onchain-facts'
import { erc20Abi } from 'viem'

// Spread to produce a mutable copy — wagmi useContractRead expects mutable ABI arrays
export const COLLECT_SPLIT_ABI = [..._CS_ABI] as typeof _CS_ABI
export const ESCROW_ABI = [..._ESC_ABI] as typeof _ESC_ABI

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
