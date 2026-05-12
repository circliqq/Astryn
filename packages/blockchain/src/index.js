import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";
export function chainByName(chainName) {
    const chains = {
        base,
        ethereum: mainnet,
        "base-sepolia": baseSepolia,
        "ethereum-sepolia": sepolia
    };
    return chains[chainName];
}
export function createMintPublicClient(options) {
    return createPublicClient({
        chain: chainByName(options.chainName),
        transport: http(options.rpcUrl, { retryCount: 2, retryDelay: 500 })
    });
}
export async function getBalance(options, address) {
    return createMintPublicClient(options).getBalance({ address });
}
export async function getNonce(options, address) {
    return createMintPublicClient(options).getTransactionCount({ address });
}
export async function estimateMintGas(options, request) {
    return createMintPublicClient(options).estimateGas(request);
}
export async function simulateTx(options, request) {
    const client = createMintPublicClient(options);
    await client.call({
        account: request.account,
        to: request.to,
        data: request.data,
        value: request.value
    });
    const gas = await client.estimateGas(request);
    return { ok: true, estimatedGas: gas };
}
export function walletClientFromPrivateKey(options, privateKey) {
    const account = privateKeyToAccount(privateKey);
    return createWalletClient({
        account,
        chain: chainByName(options.chainName),
        transport: http(options.rpcUrl, { retryCount: 0 })
    });
}
export async function signTransaction(options, privateKey, request) {
    const account = privateKeyToAccount(privateKey);
    return account.signTransaction({
        chainId: chainByName(options.chainName).id,
        to: request.to,
        data: request.data,
        value: request.value,
        gas: request.gas,
        nonce: request.nonce,
        maxFeePerGas: request.maxFeePerGas,
        maxPriorityFeePerGas: request.maxPriorityFeePerGas,
        type: "eip1559"
    });
}
export async function sendRawTransaction(options, serializedTransaction) {
    return createMintPublicClient(options).sendRawTransaction({ serializedTransaction });
}
export async function waitForReceipt(options, hash) {
    return createMintPublicClient(options).waitForTransactionReceipt({
        hash,
        confirmations: 2,
        timeout: 120_000
    });
}
//# sourceMappingURL=index.js.map