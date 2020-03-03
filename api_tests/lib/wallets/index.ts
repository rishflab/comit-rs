import { BigNumber, Lnd } from "comit-sdk";
import { Asset } from "comit-sdk";
import { HarnessGlobal, sleep } from "../utils";
import { BitcoinWallet } from "./bitcoin";
import { EthereumWallet } from "./ethereum";
import { LightningWallet } from "./lightning";
import { Logger } from "log4js";

declare var global: HarnessGlobal;

interface AllWallets {
    bitcoin?: BitcoinWallet;
    ethereum?: EthereumWallet;
    lightning?: LightningWallet;
}

export interface Wallet {
    MaximumFee: number;
    mint(asset: Asset): Promise<void>;
    getBalanceByAsset(asset: Asset): Promise<BigNumber>;
    getBlockchainTime(): Promise<number>;
}

export class Wallets {
    constructor(private readonly wallets: AllWallets) {}

    get bitcoin(): BitcoinWallet {
        return this.getWalletForLedger("bitcoin");
    }

    get ethereum(): EthereumWallet {
        return this.getWalletForLedger("ethereum");
    }

    get lightning(): LightningWallet {
        return this.getWalletForLedger("lightning");
    }

    public getWalletForLedger<K extends keyof AllWallets>(
        name: K
    ): AllWallets[K] {
        const wallet = this.wallets[name];

        if (!wallet) {
            throw new Error(`Wallet for ${name} is not initialised`);
        }

        return wallet;
    }

    public async initializeForLedger<K extends keyof AllWallets>(
        name: K,
        logger: Logger,
        lnd: { lnd: Lnd; lndP2pSocket: string } | undefined
    ) {
        switch (name) {
            case "ethereum":
                this.wallets.ethereum = new EthereumWallet(
                    global.ledgerConfigs.ethereum
                );
                break;
            case "bitcoin":
                this.wallets.bitcoin = await BitcoinWallet.newInstance(
                    global.ledgerConfigs.bitcoin
                );
                break;
            case "lightning":
                if (!lnd) {
                    throw new Error(
                        "Lnd is needed to instantiate lightning wallet."
                    );
                }
                this.wallets.lightning = await LightningWallet.newInstance(
                    await BitcoinWallet.newInstance(
                        global.ledgerConfigs.bitcoin
                    ),
                    logger,
                    lnd.lnd,
                    lnd.lndP2pSocket
                );
                break;
        }
    }
}

export async function pollUntilMinted(
    wallet: Wallet,
    minimumBalance: BigNumber,
    asset: Asset
): Promise<void> {
    const currentBalance = await wallet.getBalanceByAsset(asset);
    if (currentBalance.gte(minimumBalance)) {
        return;
    } else {
        await sleep(500);

        return pollUntilMinted(wallet, minimumBalance, asset);
    }
}
