/**
 * Client-side contract deployment hook.
 * Replaces the forge-script backend endpoint for Vercel deployment.
 * Uses wagmi's deployContract to deploy PactFormCollectSplit or PactFormEscrow
 * directly from the connected wallet.
 */
import { useCallback, useState } from 'react'
import { useWalletClient, usePublicClient } from 'wagmi'
import { encodeDeployData } from 'viem'
import { COLLECT_SPLIT_ABI, COLLECT_SPLIT_BYTECODE, ESCROW_ABI, ESCROW_BYTECODE } from '@/contract-artifacts'
import { getUsdc } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import type { PactForm } from '@/types'

const CHAIN_ID = 5042
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`
const SIGNER_ADDRESS = (import.meta.env.VITE_PACTFORM_SIGNER_ADDRESS ||
  import.meta.env.VITE_DEMO_INSTRUCTOR_ADDRESS || ZERO_ADDR) as `0x${string}`

function padTo5<T>(arr: T[], fill: T): [T, T, T, T, T] {
  const padded = [...arr]
  while (padded.length < 5) padded.push(fill)
  return padded.slice(0, 5) as [T, T, T, T, T]
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
      if (!usdcInfo) throw new Error('USDC not found for chain')
      const usdcAddress = usdcInfo.address as `0x${string}`
      const priceRaw = parseUsdc(form.price_usdc)
      const recipients = padTo5(
        (form.recipients).map(r => r as `0x${string}`),
        ZERO_ADDR
      )
      const splits = padTo5(
        (form.splits).map(s => Number(s)),
        0
      )
      const creatorAddress = walletClient.account.address

      let deployData: `0x${string}`

      if (form.payment_mode === 'collect_split') {
        deployData = encodeDeployData({
          abi: COLLECT_SPLIT_ABI,
          bytecode: COLLECT_SPLIT_BYTECODE,
          args: [
            usdcAddress,
            SIGNER_ADDRESS,
            priceRaw,
            recipients,
            splits.map(Number) as [number, number, number, number, number],
            Number(form.capacity || 0),
            creatorAddress,
          ],
        })
      } else if (form.payment_mode === 'goal_escrow') {
        deployData = encodeDeployData({
          abi: ESCROW_ABI,
          bytecode: ESCROW_BYTECODE,
          args: [
            usdcAddress,
            SIGNER_ADDRESS,
            priceRaw,
            recipients,
            splits.map(Number) as [number, number, number, number, number],
            Number(form.goal_count || 0),
            Number(form.capacity || 0),
            BigInt(form.deadline_ts || 0),
            creatorAddress,
          ],
        })
      } else {
        throw new Error('Cannot deploy contract for free forms')
      }

      const txHash = await walletClient.sendTransaction({
        data: deployData,
        value: 0n,
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (!receipt.contractAddress) throw new Error('Deploy succeeded but no contract address in receipt')

      return receipt.contractAddress
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
