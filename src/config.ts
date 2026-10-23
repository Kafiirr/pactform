/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig, fallback } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Arc Mainnet RPC — prefer the Arc Studio proxy when available, then fall back to public.
function buildArcRpcUrl(): string {
  const base = import.meta.env.VITE_RPC_PROXY_BASE_URL as string | undefined
  const token = import.meta.env.VITE_RPC_PROXY_TOKEN as string | undefined
  const chains = (import.meta.env.VITE_RPC_PROXY_CHAINS as string | undefined) ?? ''
  if (base && token && chains.split(',').map(s => s.trim()).includes('Arc')) {
    return `${base}/api/rpc/Arc?_rpc_token=${token}`
  }
  return 'https://rpc.mainnet.arc.io'
}

const ARC_MAINNET_RPCS = [
  buildArcRpcUrl(),
  'https://rpc.mainnet.arc.io',
]

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, ARC_MAINNET_RPCS[0])

export const config = createConfig({
  chains: [arc, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arc.id]: fallback(ARC_MAINNET_RPCS.map(url => http(url))),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
