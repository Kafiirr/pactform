/**
 * Debug script: reproduce the exact digest the contract computes and check
 * whether the backend's signature recovers to the expected signer.
 * Run with: bun --env-file=.env scripts/debug-sig.ts
 */
import { privateKeyToAccount } from 'viem/accounts'
import {
  keccak256, encodeAbiParameters, parseAbiParameters,
  concat, toBytes, recoverAddress, type Hex
} from 'viem'

const PRIVATE_KEY = process.env.PACTFORM_SIGNER_KEY as Hex
if (!PRIVATE_KEY) { console.error('PACTFORM_SIGNER_KEY not set'); process.exit(1) }
const account = privateKeyToAccount(PRIVATE_KEY)
console.log('Signer address:', account.address)

const CONTRACT = '0x30fc8c0e9dce79272f960f991d0a271d859c837c' as Hex
const CHAIN_ID = 5042002n

// Replicate exactly what the contract computes
const EIP712_DOMAIN_TYPEHASH = keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'))
const NAME_HASH   = keccak256(toBytes('Pactform'))
const VERSION_HASH = keccak256(toBytes('1'))

const domainSeparator = keccak256(encodeAbiParameters(
  parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
  [EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, CHAIN_ID, CONTRACT]
))
console.log('domainSeparator:', domainSeparator)

const SUBMIT_TYPEHASH = keccak256(toBytes('SubmitAuthorization(address payer,bytes32 submissionId,bytes32 responseCommitment,uint256 price,uint64 expiry)'))

// Values from the failing transaction
const payer              = '0x710e86fa6d521934864a10c2b1f5a03c3221ac02' as Hex
const submissionId       = '0x1e3952558c38479e180d702a8549f7c65c8eac218e348268e3fe679e6d5d949c' as Hex
const responseCommitment = '0x9d5e69586fc8f3fc17093112e17bd46a9dceee5f3bdb2be14405578ca9c723d5' as Hex
const price              = 490000n   // 0.49 USDC  (price stored in the "dsdsds" form)
const authExpiry         = 1792230595n

const structHash = keccak256(encodeAbiParameters(
  parseAbiParameters('bytes32, address, bytes32, bytes32, uint256, uint64'),
  [SUBMIT_TYPEHASH, payer, submissionId, responseCommitment, price, authExpiry]
))
console.log('structHash:', structHash)

const digest = keccak256(concat(['0x1901', domainSeparator, structHash]))
console.log('digest:', digest)

// 1. Recover from the signature that was actually broadcast
const txSig = '0xd042289caa47562e703894355366b8edc47883b5d8031a88c94e2c75e4eb5da120cf290e18a155d5e7bde884855a5904f6f10c11535698a8e9e28867696bd4081b' as Hex
const recovered = await recoverAddress({ hash: digest, signature: txSig })
console.log('\n--- Recovery check ---')
console.log('Recovered from tx sig:', recovered)
console.log('Match?', recovered.toLowerCase() === account.address.toLowerCase())

// 2. Sign freshly with signTypedData and verify
const freshSig = await account.signTypedData({
  domain: {
    name: 'Pactform',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: CONTRACT,
  },
  types: {
    SubmitAuthorization: [
      { name: 'payer',              type: 'address' },
      { name: 'submissionId',       type: 'bytes32' },
      { name: 'responseCommitment', type: 'bytes32' },
      { name: 'price',              type: 'uint256' },
      { name: 'expiry',             type: 'uint64'  },
    ],
  },
  primaryType: 'SubmitAuthorization',
  message: { payer, submissionId, responseCommitment, price, expiry: authExpiry },
})
console.log('\n--- Fresh signTypedData ---')
console.log('Fresh sig:', freshSig)
const recoveredFresh = await recoverAddress({ hash: digest, signature: freshSig })
console.log('Recovered fresh:', recoveredFresh)
console.log('Match?', recoveredFresh.toLowerCase() === account.address.toLowerCase())
