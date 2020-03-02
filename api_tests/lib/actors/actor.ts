import { expect } from "chai";
import {
    BigNumber,
    Cnd,
    ComitClient,
    LedgerAction,
    Swap,
    SwapDetails,
} from "comit-sdk";
import { parseEther } from "ethers/utils";
import getPort from "get-port";
import { Logger } from "log4js";
import { E2ETestActorConfig } from "../config";
import { LedgerConfig } from "../ledgers/ledger_runner";
import "../setup_chai";
import { Asset, AssetKind, toKey, toKind } from "../asset";
import { CndInstance } from "../cnd/cnd_instance";
import { Ledger, LedgerKind } from "../ledgers/ledger";
import { HarnessGlobal, sleep } from "../utils";
import { Wallet, Wallets } from "../wallets";
import { Actors } from "./index";
import { Entity } from "../../gen/siren";
import { LndInstance } from "../ledgers/lnd_instance";

declare var global: HarnessGlobal;

export class Actor {
    public static defaultActionConfig = {
        maxTimeoutSecs: 20,
        tryIntervalSecs: 1,
    };

    public static async newInstance(
        loggerFactory: (name: string) => Logger,
        name: string,
        ledgerConfig: LedgerConfig,
        projectRoot: string,
        logRoot: string
    ) {
        const actorConfig = new E2ETestActorConfig(
            await getPort(),
            await getPort(),
            name,
            await getPort(),
            await getPort()
        );

        const cndInstance = new CndInstance(
            projectRoot,
            logRoot,
            actorConfig,
            ledgerConfig
        );

        await cndInstance.start();

        const logger = loggerFactory(name);
        logger.level = "debug";

        logger.info(
            "Created new actor with config %s",
            JSON.stringify(actorConfig.generateCndConfigFile(ledgerConfig))
        );

        return new Actor(logger, cndInstance, logRoot, actorConfig);
    }

    public actors: Actors;
    public wallets: Wallets;

    private comitClient: ComitClient;
    readonly cnd: Cnd;
    private swap: Swap;

    private alphaLedger: Ledger;
    private alphaAsset: Asset;

    private betaLedger: Ledger;
    private betaAsset: Asset;

    private readonly startingBalances: Map<string, BigNumber>;
    private readonly expectedBalanceChanges: Map<string, BigNumber>;

    public lndInstance: LndInstance;

    private constructor(
        private readonly logger: Logger,
        private readonly cndInstance: CndInstance,
        private readonly logRoot: string,
        private readonly config: E2ETestActorConfig
    ) {
        this.wallets = new Wallets({});
        const { address, port } = cndInstance.getConfigFile().http_api.socket;
        this.cnd = new Cnd(`http://${address}:${port}`);

        this.startingBalances = new Map();
        this.expectedBalanceChanges = new Map();
    }

    public async sendRequest(
        maybeAlpha?: AssetKind | { ledger: LedgerKind; asset: AssetKind },
        maybeBeta?: AssetKind | { ledger: LedgerKind; asset: AssetKind }
    ) {
        this.logger.info("Sending swap request");

        // By default, we will send the swap request to bob
        const to = this.actors.bob;

        let alphaAssetKind: AssetKind;
        let alphaLedgerKind: LedgerKind;
        if (!maybeAlpha) {
            alphaAssetKind = this.defaultAlphaAssetKind();
            alphaLedgerKind = this.defaultAlphaLedgerKind();
        } else if (typeof maybeAlpha === "string") {
            alphaAssetKind = maybeAlpha;
            alphaLedgerKind = defaultLedgerKindForAsset(alphaAssetKind);
        } else {
            alphaAssetKind = maybeAlpha.asset;
            alphaLedgerKind = maybeAlpha.ledger;
        }

        this.alphaLedger = defaultLedgerDescriptionForLedger(alphaLedgerKind);
        this.alphaAsset = defaultAssetDescription(
            alphaAssetKind,
            alphaLedgerKind
        );
        to.alphaLedger = this.alphaLedger;
        to.alphaAsset = this.alphaAsset;

        this.logger.debug(
            "Derived Alpha Ledger %o from %s",
            this.alphaLedger,
            alphaLedgerKind
        );
        this.logger.debug(
            "Derived Alpha Asset %o from %s",
            this.alphaAsset,
            alphaAssetKind
        );

        let betaAssetKind;
        let betaLedgerKind;
        if (!maybeBeta) {
            betaAssetKind = this.defaultBetaAssetKind();
            betaLedgerKind = this.defaultBetaLedgerKind();
        } else if (typeof maybeBeta === "string") {
            betaAssetKind = maybeBeta;
            betaLedgerKind = defaultLedgerKindForAsset(betaAssetKind);
        } else {
            betaAssetKind = maybeBeta.asset;
            betaLedgerKind = maybeBeta.ledger;
        }

        this.betaLedger = defaultLedgerDescriptionForLedger(betaLedgerKind);
        this.betaAsset = defaultAssetDescription(betaAssetKind, betaLedgerKind);
        to.betaLedger = this.betaLedger;
        to.betaAsset = this.betaAsset;

        this.logger.debug(
            "Derived Beta Ledger %o from %s",
            this.betaLedger,
            betaLedgerKind
        );
        this.logger.debug(
            "Derived Beta Asset %o from %s",
            this.betaAsset,
            betaAssetKind
        );

        await this.initializeDependencies();
        await to.initializeDependencies();

        await this.setStartingBalance([
            this.alphaAsset,
            {
                name: this.betaAsset.name,
                ledger: this.betaLedger.name,
                quantity: "0",
            },
        ]);
        await to.setStartingBalance([
            {
                name: to.alphaAsset.name,
                ledger: this.alphaLedger.name,
                quantity: "0",
            },
            to.betaAsset,
        ]);

        const isLightning =
            this.alphaLedger.name === "lightning" ||
            this.betaLedger.name === "lightning";

        if (isLightning) {
            this.logger.debug(`Initialising lightning for ${this.config.name}`);
            const thisLightningWallet = this.wallets.getWalletForLedger(
                "lightning"
            );
            const toLightningWallet = to.wallets.getWalletForLedger(
                "lightning"
            );

            await thisLightningWallet.connectPeer(toLightningWallet);

            if (this.alphaLedger.name === "lightning") {
                // Alpha Ledger is lightning so Alice will be sending assets over lightning
                const quantity = parseInt(this.alphaAsset.quantity, 10);
                await thisLightningWallet.openChannel(
                    toLightningWallet,
                    quantity * 1.5 // Similarly to minting, we open a channel with a bit more than what is needed for the swap
                );
            } else {
                // Beta Ledger is lightning so Bob will be sending assets over lightning
                const quantity = parseInt(this.betaAsset.quantity, 10);
                await toLightningWallet.openChannel(
                    thisLightningWallet,
                    quantity * 1.5 // Similarly to minting, we open a channel with a bit more than what is needed for the swap
                );
            }
        }

        this.expectedBalanceChanges.set(
            toKey(this.betaAsset),
            new BigNumber(this.betaAsset.quantity)
        );
        to.expectedBalanceChanges.set(
            toKey(this.alphaAsset),
            new BigNumber(to.alphaAsset.quantity)
        );

        if (isLightning) {
            this.logger.debug("Using lightning routes on cnd REST API");
            return;
        }
        const comitClient: ComitClient = this.getComitClient();

        const payload = {
            alpha_ledger: this.alphaLedger,
            beta_ledger: this.betaLedger,
            alpha_asset: this.alphaAsset,
            beta_asset: this.betaAsset,
            peer: {
                peer_id: await to.cnd.getPeerId(),
                address_hint: await to.cnd
                    .getPeerListenAddresses()
                    .then(addresses => addresses[0]),
            },
            ...(await this.additionalIdentities(alphaAssetKind, betaAssetKind)),
            ...defaultExpiryTimes(),
        };

        this.swap = await comitClient.sendSwap(payload);
        to.swap = new Swap(to.cnd, this.swap.self, {
            bitcoinWallet: to.wallets.bitcoin.inner,
            ethereumWallet: to.wallets.ethereum.inner,
        });
        this.logger.debug("Created new swap at %s", this.swap.self);

        return this.swap;
    }

    public async accept() {
        if (!this.swap) {
            throw new Error("Cannot accept non-existent swap");
        }

        await this.swap.accept(Actor.defaultActionConfig);
    }

    public async deploy() {
        if (!this.swap) {
            throw new Error("Cannot deploy htlc for nonexistent swap");
        }

        const txid = await this.swap.deploy(Actor.defaultActionConfig);
        this.logger.debug(
            "Deployed htlc for swap %s in %s",
            this.swap.self,
            txid
        );

        const entity = await this.swap.fetchDetails();
        switch (entity.properties.role) {
            case "Alice":
                await this.actors.alice.assertAlphaDeployed();
                if (this.actors.bob.cndInstance.isRunning()) {
                    await this.actors.bob.assertAlphaDeployed();
                }
                break;
            case "Bob":
                if (this.actors.alice.cndInstance.isRunning()) {
                    await this.actors.alice.assertBetaDeployed();
                }
                await this.actors.bob.assertBetaDeployed();
                break;
        }
    }

    public async fund() {
        if (!this.swap) {
            throw new Error("Cannot fund nonexistent swap");
        }

        const txid = await this.swap.fund(Actor.defaultActionConfig);
        this.logger.debug("Funded swap %s in %s", this.swap.self, txid);

        const role = await this.whoAmI();
        switch (role) {
            case "Alice":
                await this.actors.alice.assertAlphaFunded();
                if (this.actors.bob.cndInstance.isRunning()) {
                    await this.actors.bob.assertAlphaFunded();
                }
                break;
            case "Bob":
                if (this.actors.alice.cndInstance.isRunning()) {
                    await this.actors.alice.assertBetaFunded();
                }
                await this.actors.bob.assertBetaFunded();
                break;
        }
    }

    public async fundLowGas(hexGasLimit: string) {
        const response = await this.swap.tryExecuteSirenAction<LedgerAction>(
            "fund",
            {
                maxTimeoutSecs: 10,
                tryIntervalSecs: 1,
            }
        );
        response.data.payload.gas_limit = hexGasLimit;
        const txid = await this.swap.doLedgerAction(response.data);
        this.logger.debug(
            "Deployed with low gas swap %s in %s",
            this.swap.self,
            txid
        );

        const status = await this.wallets.ethereum.getTransactionStatus(txid);
        if (status !== 0) {
            throw new Error("Deploy with low gas transaction was successful.");
        }
    }

    public async overfund() {
        const response = await this.swap.tryExecuteSirenAction<LedgerAction>(
            "fund",
            {
                maxTimeoutSecs: 10,
                tryIntervalSecs: 1,
            }
        );
        const amount = response.data.payload.amount;
        response.data.payload.amount = amount * 1.01;

        const txid = await this.swap.doLedgerAction(response.data);
        this.logger.debug("Overfunded swap %s in %s", this.swap.self, txid);
    }

    public async underfund() {
        const response = await this.swap.tryExecuteSirenAction<LedgerAction>(
            "fund",
            {
                maxTimeoutSecs: 10,
                tryIntervalSecs: 1,
            }
        );
        const amount = response.data.payload.amount;
        response.data.payload.amount = amount * 0.01;

        const txid = await this.swap.doLedgerAction(response.data);
        this.logger.debug("Underfunded swap %s in %s", this.swap.self, txid);
    }

    public async refund() {
        if (!this.swap) {
            throw new Error("Cannot refund non-existent swap");
        }

        const role = await this.whoAmI();
        switch (role) {
            case "Alice":
                await this.waitForAlphaExpiry();
                break;
            case "Bob":
                await this.waitForBetaExpiry();
                break;
        }

        const txid = await this.swap.refund(Actor.defaultActionConfig);
        this.logger.debug("Refunded swap %s in %s", this.swap.self, txid);

        switch (role) {
            case "Alice":
                await this.actors.alice.assertAlphaRefunded();
                if (this.actors.bob.cndInstance.isRunning()) {
                    await this.actors.bob.assertAlphaRefunded();
                }
                break;
            case "Bob":
                if (this.actors.alice.cndInstance.isRunning()) {
                    await this.actors.alice.assertBetaRefunded();
                }
                await this.actors.bob.assertBetaRefunded();
                break;
        }
    }

    public async redeem() {
        if (!this.swap) {
            throw new Error("Cannot redeem non-existent swap");
        }

        const txid = await this.swap.redeem(Actor.defaultActionConfig);
        this.logger.debug("Redeemed swap %s in %s", this.swap.self, txid);

        const role = await this.whoAmI();
        switch (role) {
            case "Alice":
                await this.actors.alice.assertBetaRedeemed();
                if (this.actors.bob.cndInstance.isRunning()) {
                    await this.actors.bob.assertBetaRedeemed();
                }
                break;
            case "Bob":
                if (this.actors.alice.cndInstance.isRunning()) {
                    await this.actors.alice.assertAlphaRedeemed();
                }
                await this.actors.bob.assertAlphaRedeemed();
                break;
        }
    }

    public async redeemWithHighFee() {
        // Hack the bitcoin fee per WU returned by the wallet
        this.wallets.bitcoin.inner.getFee = () => "100000000";

        return this.swap.tryExecuteSirenAction<LedgerAction>("redeem", {
            maxTimeoutSecs: 10,
            tryIntervalSecs: 1,
        });
    }

    public async currentSwapIsAccepted() {
        let swapEntity;

        do {
            swapEntity = await this.swap.fetchDetails();

            await sleep(200);
        } while (
            swapEntity.properties.state.communication.status !== "ACCEPTED"
        );
    }

    public async assertSwapped() {
        this.logger.debug("Checking if cnd reports status 'SWAPPED'");

        while (true) {
            await sleep(200);
            const entity = await this.swap.fetchDetails();
            if (entity.properties.status === "SWAPPED") {
                break;
            }
        }

        for (const [
            assetKey,
            expectedBalanceChange,
        ] of this.expectedBalanceChanges.entries()) {
            this.logger.debug(
                "Checking that %s balance changed by %d",
                assetKey,
                expectedBalanceChange
            );

            const { asset, ledger } = toKind(assetKey);

            const wallet = this.wallets[ledger];
            const expectedBalance = new BigNumber(
                this.startingBalances.get(assetKey)
            ).plus(expectedBalanceChange);
            const maximumFee = wallet.MaximumFee;

            const balanceInclFees = expectedBalance.minus(maximumFee);

            const currentWalletBalance = await wallet.getBalanceByAsset(
                defaultAssetDescription(asset, ledger)
            );

            expect(currentWalletBalance).to.be.bignumber.gte(balanceInclFees);

            this.logger.debug(
                "Balance check was positive, current balance is %d",
                currentWalletBalance
            );
        }
    }

    public async assertRefunded() {
        this.logger.debug("Checking if swap @ %s was refunded", this.swap.self);

        for (const [assetKey] of this.startingBalances.entries()) {
            const { asset, ledger } = toKind(assetKey);

            const wallet = this.wallets[ledger];
            const maximumFee = wallet.MaximumFee;

            this.logger.debug(
                "Checking that %s balance changed by max %d (MaximumFee)",
                assetKey,
                maximumFee
            );
            const expectedBalance = new BigNumber(
                this.startingBalances.get(assetKey)
            );
            const currentWalletBalance = await wallet.getBalanceByAsset(
                defaultAssetDescription(asset, ledger)
            );
            const balanceInclFees = expectedBalance.minus(maximumFee);
            expect(currentWalletBalance).to.be.bignumber.gte(balanceInclFees);
        }
    }

    public async assertAlphaDeployed() {
        await this.assertLedgerState("alpha_ledger", "DEPLOYED");
    }

    public async assertBetaDeployed() {
        await this.assertLedgerState("beta_ledger", "DEPLOYED");
    }

    public async assertAlphaFunded() {
        await this.assertLedgerState("alpha_ledger", "FUNDED");
    }

    public async assertBetaFunded() {
        await this.assertLedgerState("beta_ledger", "FUNDED");
    }

    public async assertAlphaRedeemed() {
        await this.assertLedgerState("alpha_ledger", "REDEEMED");
    }

    public async assertBetaRedeemed() {
        await this.assertLedgerState("beta_ledger", "REDEEMED");
    }

    public async assertAlphaRefunded() {
        await this.assertLedgerState("alpha_ledger", "REFUNDED");
    }

    public async assertBetaRefunded() {
        await this.assertLedgerState("beta_ledger", "REFUNDED");
    }

    public async assertAlphaIncorrectlyFunded() {
        await this.assertLedgerState("alpha_ledger", "INCORRECTLY_FUNDED");
    }

    public async assertBetaIncorrectlyFunded() {
        await this.assertLedgerState("beta_ledger", "INCORRECTLY_FUNDED");
    }

    public async assertAlphaNotDeployed() {
        await sleep(3000); // It is meaningless to assert before cnd processes a new block
        await this.assertLedgerState("alpha_ledger", "NOT_DEPLOYED");
    }

    public async assertBetaNotDeployed() {
        await sleep(3000); // It is meaningless to assert before cnd processes a new block
        await this.assertLedgerState("beta_ledger", "NOT_DEPLOYED");
    }

    public async start() {
        await this.cndInstance.start();
    }

    public stop() {
        this.logger.debug("Stopping actor");
        this.cndInstance.stop();
        if (this.lndInstance && this.lndInstance.isRunning()) {
            this.lndInstance.stop();
        }
    }

    public async restart() {
        this.stop();
        await this.start();
    }

    public async dumpState() {
        this.logger.debug("dumping current state");

        if (this.swap) {
            const swapDetails = await this.swap.fetchDetails();

            this.logger.debug("swap status: %s", swapDetails.properties.status);
            this.logger.debug("swap details: ", JSON.stringify(swapDetails));

            this.logger.debug(
                "alpha ledger wallet balance %d",
                await this.alphaLedgerWallet().getBalanceByAsset(
                    this.alphaAsset
                )
            );
            this.logger.debug(
                "beta ledger wallet balance %d",
                await this.betaLedgerWallet().getBalanceByAsset(this.betaAsset)
            );
        }
    }

    public async whoAmI() {
        const entity = await this.swap.fetchDetails();
        return entity.properties.role;
    }

    private async waitForAlphaExpiry() {
        const swapDetails = await this.swap.fetchDetails();

        const expiry = swapDetails.properties.state.communication.alpha_expiry;
        const wallet = this.alphaLedgerWallet();

        await this.waitForExpiry(wallet, expiry);
    }

    private async waitForBetaExpiry() {
        const swapDetails = await this.swap.fetchDetails();

        const expiry = swapDetails.properties.state.communication.beta_expiry;
        const wallet = this.betaLedgerWallet();

        await this.waitForExpiry(wallet, expiry);
    }

    private alphaLedgerWallet() {
        return this.wallets.getWalletForLedger(this.alphaLedger.name);
    }

    private betaLedgerWallet() {
        return this.wallets.getWalletForLedger(this.betaLedger.name);
    }

    private async waitForExpiry(wallet: Wallet, expiry: number) {
        let currentBlockchainTime = await wallet.getBlockchainTime();

        this.logger.debug(
            `Current blockchain time is ${currentBlockchainTime}`
        );

        let diff = expiry - currentBlockchainTime;

        if (diff > 0) {
            this.logger.debug(`Waiting for blockchain time to pass ${expiry}`);

            while (diff > 0) {
                await sleep(1000);

                currentBlockchainTime = await wallet.getBlockchainTime();
                diff = expiry - currentBlockchainTime;

                this.logger.debug(
                    `Current blockchain time is ${currentBlockchainTime}`
                );
            }
        }
    }

    private async assertLedgerState(
        ledger: string,
        status:
            | "NOT_DEPLOYED"
            | "DEPLOYED"
            | "FUNDED"
            | "REDEEMED"
            | "REFUNDED"
            | "INCORRECTLY_FUNDED"
    ) {
        this.logger.debug(
            "Waiting for cnd to see %s in state %s for swap @ %s",
            ledger,
            status,
            this.swap.self
        );

        let swapEntity;

        do {
            swapEntity = await this.swap.fetchDetails();

            await sleep(200);
        } while (swapEntity.properties.state[ledger].status !== status);

        this.logger.debug(
            "cnd saw %s in state %s for swap @ %s",
            ledger,
            status,
            this.swap.self
        );
    }

    private async additionalIdentities(
        alphaAsset: AssetKind,
        betaAsset: AssetKind
    ) {
        if (alphaAsset === "bitcoin" && betaAsset === "ether") {
            return {
                beta_ledger_redeem_identity: this.wallets.ethereum.account(),
            };
        }

        return {};
    }

    private async initializeDependencies() {
        const lightningNeeded =
            this.alphaLedger.name === "lightning" ||
            this.betaLedger.name === "lightning";

        if (lightningNeeded) {
            this.lndInstance = new LndInstance(
                this.logger,
                this.logRoot,
                this.config,
                global.ledgerConfigs.bitcoin.dataDir
            );
            await this.lndInstance.start();
        }

        for (const ledgerName of [
            this.alphaLedger.name,
            this.betaLedger.name,
        ]) {
            let lnd;
            if (this.lndInstance) {
                lnd = {
                    lnd: this.lndInstance.lnd,
                    lndP2pHost: this.lndInstance.getLightningHost(),
                    lndP2pPort: this.lndInstance.getLightningPort(),
                };
            }
            await this.wallets.initializeForLedger(
                ledgerName,
                this.logger,
                lnd
            );
        }

        if (!lightningNeeded) {
            this.comitClient = new ComitClient(this.cnd)
                .withBitcoinWallet(
                    this.wallets.getWalletForLedger("bitcoin").inner
                )
                .withEthereumWallet(
                    this.wallets.getWalletForLedger("ethereum").inner
                );
        }
    }

    private getComitClient(): ComitClient {
        if (!this.comitClient) {
            throw new Error("ComitClient is not initialised");
        }

        return this.comitClient;
    }

    private async setStartingBalance(assets: Asset[]) {
        for (const asset of assets) {
            if (parseFloat(asset.quantity) === 0) {
                this.startingBalances.set(toKey(asset), new BigNumber(0));
                continue;
            }

            const ledger = defaultLedgerDescriptionForLedger(asset.ledger);
            const ledgerName = ledger.name;

            this.logger.debug("Minting %s on %s", asset.name, ledgerName);
            await this.wallets.getWalletForLedger(ledgerName).mint(asset);

            const balance = await this.wallets[ledgerName].getBalanceByAsset(
                asset
            );

            this.logger.debug(
                "Starting %s balance: ",
                asset.name,
                balance.toString()
            );
            this.startingBalances.set(toKey(asset), balance);
        }
    }

    private defaultAlphaAssetKind() {
        const defaultAlphaAssetKind = AssetKind.Bitcoin;
        this.logger.info(
            "AssetKind for alpha asset not specified, defaulting to %s",
            defaultAlphaAssetKind
        );

        return defaultAlphaAssetKind;
    }

    private defaultAlphaLedgerKind() {
        const defaultAlphaLedgerKind = LedgerKind.Bitcoin;
        this.logger.info(
            "LedgerKind for alpha ledger not specified, defaulting to %s",
            defaultAlphaLedgerKind
        );

        return defaultAlphaLedgerKind;
    }

    private defaultBetaAssetKind() {
        const defaultBetaAssetKind = AssetKind.Ether;
        this.logger.info(
            "AssetKind for beta asset not specified, defaulting to %s",
            defaultBetaAssetKind
        );

        return defaultBetaAssetKind;
    }

    private defaultBetaLedgerKind() {
        const defaultBetaLedgerKind = LedgerKind.Ethereum;
        this.logger.info(
            "LedgerKind for beta ledger not specified, defaulting to %s",
            defaultBetaLedgerKind
        );

        return defaultBetaLedgerKind;
    }

    public cndHttpApiUrl() {
        const cndSocket = this.cndInstance.getConfigFile().http_api.socket;
        return `http://${cndSocket.address}:${cndSocket.port}`;
    }

    public async pollCndUntil(
        location: string,
        predicate: (body: Entity) => boolean
    ): Promise<Entity> {
        const response = await this.cnd.fetch(location);

        expect(response).to.have.status(200);

        if (predicate(response.data)) {
            return response.data;
        } else {
            await sleep(500);

            return this.pollCndUntil(location, predicate);
        }
    }

    public async pollSwapDetails(
        swapUrl: string,
        iteration: number = 0
    ): Promise<SwapDetails> {
        if (iteration > 5) {
            throw new Error(`Could not retrieve Swap ${swapUrl}`);
        }
        iteration++;

        try {
            return (await this.cnd.fetch<SwapDetails>(swapUrl)).data;
        } catch (error) {
            await sleep(1000);
            return this.pollSwapDetails(swapUrl, iteration);
        }
    }

    public async createLnInvoice(sats: string) {
        this.logger.debug(`Creating invoice for ${sats} sats`);
        return this.wallets.lightning.addInvoice(sats);
    }

    public async payLnInvoice(request: string): Promise<void> {
        this.logger.debug(`Paying invoice with request ${request}`);
        await this.wallets.lightning.pay(request);
    }

    public async assertLnInvoiceSettled(secretHash: string) {
        const resp = await this.wallets.lightning.lookupInvoice(secretHash);
        this.logger.debug(
            `Checking if invoice is settled, status is: ${resp.state}`
        );
        if (resp.state !== 1) {
            // This is InvoiceState.SETTLED from lnd-async. Hardcoding value until type definition is sorted.
            throw new Error(`Invoice ${secretHash} is not confirmed}`);
        }
    }
}

function defaultLedgerKindForAsset(asset: AssetKind): LedgerKind {
    switch (asset) {
        case AssetKind.Bitcoin:
            return LedgerKind.Bitcoin;
        case AssetKind.Ether:
            return LedgerKind.Ethereum;
        case AssetKind.Erc20:
            return LedgerKind.Ethereum;
    }
}

/**
 * WIP as the cnd REST API routes for lightning are not yet defined.
 * @param ledger
 * @returns The ledger formatted as needed for the request body to cnd HTTP API on the lightning route.
 */
function defaultLedgerDescriptionForLedger(ledger: LedgerKind): Ledger {
    switch (ledger) {
        case LedgerKind.Lightning: {
            return {
                name: LedgerKind.Lightning,
            };
        }
        case LedgerKind.Bitcoin: {
            return {
                name: LedgerKind.Bitcoin,
                network: "regtest",
            };
        }
        case LedgerKind.Ethereum: {
            return {
                name: LedgerKind.Ethereum,
                chain_id: 17,
            };
        }
    }
}

function defaultAssetDescription(asset: AssetKind, ledger: LedgerKind): Asset {
    switch (asset) {
        case AssetKind.Bitcoin: {
            return {
                name: AssetKind.Bitcoin,
                ledger,
                quantity: "10000000",
            };
        }
        case AssetKind.Ether: {
            return {
                name: AssetKind.Ether,
                ledger,
                quantity: parseEther("10").toString(),
            };
        }
        case AssetKind.Erc20: {
            return {
                name: AssetKind.Erc20,
                ledger,
                quantity: parseEther("100").toString(),
                token_contract: global.tokenContract,
            };
        }
    }
}

function defaultExpiryTimes() {
    const alphaExpiry = Math.round(Date.now() / 1000) + 8;
    const betaExpiry = Math.round(Date.now() / 1000) + 3;

    return {
        alpha_expiry: alphaExpiry,
        beta_expiry: betaExpiry,
    };
}
