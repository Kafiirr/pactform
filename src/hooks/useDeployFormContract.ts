/**
 * Client-side contract deployment hook.
 * Uses walletClient.deployContract (viem) which handles ABI encoding
 * internally — avoids encodeDeployData crashes from readonly ABI types.
 */
import { useCallback, useState } from 'react'
import { useWalletClient, usePublicClient } from 'wagmi'
import { COLLECT_SPLIT_ABI, COLLECT_SPLIT_BYTECODE, ESCROW_ABI, ESCROW_BYTECODE } from '@/contract-artifacts'
import { getUsdc } from '@/onchain-facts'
import type { PactForm } from '@/types'

const CHAIN_ID = 5042
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

const SIGNER_ADDRESS = (
  import.meta.env.VITE_PACTFORM_SIGNER_ADDRESS ||
  import.meta.env.VITE_DEMO_INSTRUCTOR_ADDRESS ||
  ZERO_ADDR
) as `0x${string}`

function padTo5Addr(arr: unknown[]): [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`] {
  const safe = Array.isArray(arr) ? arr : []
  const padded = safe.map(r => (typeof r === 'string' && r ? r as `0x${string}` : ZERO_ADDR))
  while (padded.length < 5) padded.push(ZERO_ADDR)
  return padded.slice(0, 5) as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`]
}

function padTo5Num(arr: unknown[]): [number, number, number, number, number] {
  const safe = Array.isArray(arr) ? arr : []
  const padded = safe.map(s => {
    const n = typeof s === 'number' ? s : Number(s)
    return isNaN(n) ? 0 : n
  })
  while (padded.length < 5) padded.push(0)
  return padded.slice(0, 5) as [number, number, number, number, number]
}

function parseUsdcLocal(amount: string | undefined | null): bigint {
  if (!amount) return 0n
  const str = String(amount).trim()
  const [integer = '0', fractional = ''] = str.split('.')
  const frac = fractional.padEnd(6, '0').slice(0, 6)
  try {
    return BigInt(integer || '0') * 1_000_000n + BigInt(frac || '0')
  } catch {
    return 0n
  }
}

export function useDeployFormContract() {
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const [isDeploying, setIsDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deploy = useCallback(async (form: PactForm): Promise<string> => {
    if (!walletClient) throw new Error('Wallet not connected')
    if (!publicClient) throw new Error('Public client unavailable')

    setIsDeploying(true)
    setError(null)

    try {
      const usdcInfo = getUsdc(CHAIN_ID)
      if (!usdcInfo) throw new Error('USDC not found for chain ' + CHAIN_ID)
      const usdcAddress = usdcInfo.address as `0x${string}`

      const priceRaw = parseUsdcLocal(form.price_usdc)
      if (priceRaw === 0n) throw new Error(`Invalid price: "${form.price_usdc}"`)

      const recipients = padTo5Addr(form.recipients)
      const splits = padTo5Num(form.splits)
      const creatorAddress = walletClient.account.address

      if (!SIGNER_ADDRESS || SIGNER_ADDRESS === ZERO_ADDR) {
        throw new Error('Signer address not configured. Set VITE_PACTFORM_SIGNER_ADDRESS in Vercel env vars.')
      }

      let contractAddress: `0x${string}`

      if (form.payment_mode === 'collect_split') {
        const hash = await walletClient.deployContract({
          abi: COLLECT_SPLIT_ABI,
          bytecode: COLLECT_SPLIT_BYTECODE,
          args: [
            usdcAddress,
            SIGNER_ADDRESS,
            priceRaw,
            recipients,
            splits,
            Number(form.capacity ?? 0),
            creatorAddress,
          ],
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (!receipt.contractAddress) throw new Error('Deploy succeeded but no contract address in receipt')
        contractAddress = receipt.contractAddress

      } else if (form.payment_mode === 'goal_escrow') {
        const hash = await walletClient.deployContract({
          abi: ESCROW_ABI,
          bytecode: ESCROW_BYTECODE,
          args: [
            usdcAddress,
            SIGNER_ADDRESS,
            priceRaw,
            recipients,
            splits,
            Number(form.goal_count ?? 0),
            Number(form.capacity ?? 0),
            BigInt(form.deadline_ts ?? 0),
            creatorAddress,
          ],
        })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (!receipt.contractAddress) throw new Error('Deploy succeeded but no contract address in receipt')
        contractAddress = receipt.contractAddress

      } else {
        throw new Error('Cannot deploy contract for free forms')
      }

      return contractAddress
    } catch (e) {
      const msg = (e as Error).message || 'Deploy failed'
      setError(msg)
      throw e
    } finally {
      setIsDeploying(false)
    }
  }, [walletClient, publicClient])

  return { deploy, isDeploying, error }
}
