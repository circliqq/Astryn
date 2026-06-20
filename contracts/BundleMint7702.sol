// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * BundleMint7702
 * ===========================================================================
 * Atomic, single-transaction "bundle mint" powered by EIP-7702 (Pectra).
 *
 * Roles (mirrors the Falcon-style Deploy → contract group):
 *   - OWNER     : admin. Deploys the contract, can rotate the relayer / owner.
 *   - RELAYER   : the only address allowed to trigger `orchestrate*` (i.e. the
 *                 tx-sender / sponsor wallet that broadcasts the bundle).
 *   - EXECUTOR  : THIS contract's own address (`SELF`). Sub-wallets 7702-
 *                 delegate to it; `mintExec`/`callExec` run in their context.
 *
 * Flow:
 *   1. Each SUB-WALLET signs a 7702 authorization delegating to EXECUTOR (this
 *      contract's address). Off-chain, gasless for the sub-wallet.
 *   2. The RELAYER sends ONE type-4 tx: authorizationList = all sub-wallet
 *      authorizations, to = this contract, data = orchestrate*(...).
 *   3. EVM applies the authorizations, then orchestrate* loops and mints from
 *      each sub-wallet in its own context — atomic, one block.
 *
 * Value Payer (per call, `payFromSender`):
 *   - true  (Tx Sender)       : the relayer forwards mint ETH; sub-wallets need
 *                               no balance. msg.value must cover all mints.
 *   - false (Delegated Wallet): each sub-wallet pays the mint price from its
 *                               OWN balance; the relayer only pays gas.
 *
 * Security:
 *   - `orchestrate*` is gated to RELAYER/OWNER.
 *   - `mintExec`/`callExec` are gated to `msg.sender == SELF`, so a delegated
 *     sub-wallet can only ever be driven by this canonical contract.
 *   - Executors write no storage (no EOA storage pollution). Role state lives
 *     only on the canonical instance (orchestrate never runs in a delegated
 *     context, so it always reads the real role values).
 *
 * ⚠️ Reference implementation — AUDIT before mainnet use. Deploy via CREATE2,
 *    immutable (non-proxy), per EIP-7702 phishing guidance.
 */

interface ISeaDrop {
    function mintPublic(
        address nftContract,
        address feeRecipient,
        address minterIfNotPayer,
        uint256 quantity
    ) external payable;
}

contract BundleMint7702 {
    /// Canonical address of the deployed instance (the EXECUTOR). Immutable, so
    /// delegated sub-wallets read the same value from bytecode.
    address public immutable SELF;

    address public owner;
    address public relayer;
    bool private _locked;

    error NotOwner();
    error NotRelayer();
    error NotSelf();
    error Reentrancy();
    error InsufficientValue();
    error MintFailed(address minter);
    error ExecFailed(address minter);

    event OwnerChanged(address indexed previous, address indexed next);
    event RelayerChanged(address indexed previous, address indexed next);
    event BundleMinted(address indexed minter, uint256 value);

    constructor(address owner_, address relayer_) {
        SELF = address(this);
        owner = owner_ == address(0) ? msg.sender : owner_;
        relayer = relayer_ == address(0) ? owner : relayer_;
        emit OwnerChanged(address(0), owner);
        emit RelayerChanged(address(0), relayer);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer && msg.sender != owner) revert NotRelayer();
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    // ── Admin (owner only) ────────────────────────────────────────────────────

    function setOwner(address next) external onlyOwner {
        emit OwnerChanged(owner, next);
        owner = next;
    }

    function setRelayer(address next) external onlyOwner {
        emit RelayerChanged(relayer, next);
        relayer = next;
    }

    // ── Orchestrators (relayer triggers on the canonical instance) ───────────

    /**
     * SeaDrop public mint for every delegated sub-wallet.
     * @param payFromSender true = relayer forwards mint ETH; false = each
     *        sub-wallet pays from its own balance.
     */
    function orchestrateSeaDrop(
        address[] calldata minters,
        address seadrop,
        address nft,
        address feeRecipient,
        uint256 quantity,
        uint256 pricePerMint,
        bool payFromSender
    ) external payable onlyRelayer nonReentrant {
        uint256 perMinter = pricePerMint * quantity;
        if (payFromSender && msg.value < perMinter * minters.length) revert InsufficientValue();

        for (uint256 i = 0; i < minters.length; i++) {
            address minter = minters[i];
            uint256 forwarded = payFromSender ? perMinter : 0;
            (bool ok, ) = minter.call{value: forwarded}(
                abi.encodeWithSelector(
                    this.mintExec.selector,
                    seadrop,
                    nft,
                    feeRecipient,
                    quantity,
                    perMinter
                )
            );
            if (!ok) revert MintFailed(minter);
            emit BundleMinted(minter, perMinter);
        }

        _refundDust();
    }

    /**
     * Generic mint: forwards the same calldata to `target` from each sub-wallet.
     */
    function orchestrateCall(
        address[] calldata minters,
        address target,
        uint256 perMinterValue,
        bytes calldata data,
        bool payFromSender
    ) external payable onlyRelayer nonReentrant {
        if (payFromSender && msg.value < perMinterValue * minters.length) revert InsufficientValue();

        for (uint256 i = 0; i < minters.length; i++) {
            address minter = minters[i];
            uint256 forwarded = payFromSender ? perMinterValue : 0;
            (bool ok, ) = minter.call{value: forwarded}(
                abi.encodeWithSelector(this.callExec.selector, target, perMinterValue, data)
            );
            if (!ok) revert ExecFailed(minter);
            emit BundleMinted(minter, perMinterValue);
        }

        _refundDust();
    }

    // ── Executors (run inside a sub-wallet's context via 7702) ───────────────
    // `value` is paid from the executing account's balance — that balance is
    // either the relayer-forwarded ETH (payFromSender) or the sub-wallet's own.

    function mintExec(
        address seadrop,
        address nft,
        address feeRecipient,
        uint256 quantity,
        uint256 value
    ) external payable {
        if (msg.sender != SELF) revert NotSelf();
        ISeaDrop(seadrop).mintPublic{value: value}(nft, feeRecipient, address(this), quantity);
    }

    function callExec(address target, uint256 value, bytes calldata data) external payable {
        if (msg.sender != SELF) revert NotSelf();
        (bool ok, ) = target.call{value: value}(data);
        if (!ok) revert ExecFailed(address(this));
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _refundDust() private {
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool r, ) = msg.sender.call{value: remaining}("");
            r; // ignore — sponsor is our own wallet
        }
    }

    receive() external payable {}
}
