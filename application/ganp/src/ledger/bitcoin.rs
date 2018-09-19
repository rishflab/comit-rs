use bitcoin_rpc_client::TransactionId;
use bitcoin_support::{Address, BitcoinQuantity, Blocks, Network, PubkeyHash};
use ledger::Ledger;
use secp256k1_support::PublicKey;
use swap;

#[derive(Clone, Debug, PartialEq)]
pub struct Bitcoin {
    network: Network,
}

impl Bitcoin {
    pub fn new(network: Network) -> Self {
        Bitcoin { network }
    }

    pub fn regtest() -> Self {
        Bitcoin {
            network: Network::Regtest,
        }
    }
}

impl Default for Bitcoin {
    fn default() -> Self {
        Bitcoin {
            network: Network::Regtest,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct HtlcId {
    pub transaction_id: TransactionId,
    pub vout: u32,
}

impl Ledger for Bitcoin {
    type Quantity = BitcoinQuantity;
    type Address = Address;
    type LockDuration = Blocks;
    type HtlcId = HtlcId;
    type TxId = TransactionId;
    type Pubkey = PublicKey;
    type Identity = PubkeyHash;

    fn symbol() -> String {
        String::from("BTC")
    }

    fn address_for_identity(&self, pubkeyhash: PubkeyHash) -> Address {
        Address::from_pubkeyhash_and_network(pubkeyhash, self.network)
    }
}

impl From<Bitcoin> for swap::Ledger {
    fn from(_: Bitcoin) -> Self {
        swap::Ledger::Bitcoin
    }
}

impl Bitcoin {
    pub fn network(&self) -> Network {
        self.network
    }
}
