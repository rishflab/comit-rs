use bitcoin::{
    self,
    blockdata::script,
    util::address::{Address as BitcoinAddress, Payload},
};
use bitcoin_bech32::{self, WitnessProgram};
use bitcoin_rpc_client;
use pubkey::PubkeyHash;
use secp256k1_support::PublicKey;
use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::{
    fmt,
    hash::{Hash, Hasher},
    str::FromStr,
};
use Network;

#[derive(Debug, PartialEq, Clone)]
pub struct Address(BitcoinAddress);

// These (Eq, Hash, Serialize, Deserialize) work on the assumption that there is NO mix of Networks
// (testnet, regtest) in the program.
// Meaning that when executed, either all addresses are testnet or all addresses are regtest.
// From the moment the program expect to connect to several bitcoind which are connected to
// different nets, then all hell breaks loose.
impl Eq for Address {}

impl AsRef<BitcoinAddress> for Address {
    fn as_ref(&self) -> &BitcoinAddress {
        &self.0
    }
}

impl Hash for Address {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.to_string().hash(state);
    }
}

impl FromStr for Address {
    type Err = bitcoin::network::serialize::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        BitcoinAddress::from_str(s).and_then(|address| Ok(Address(address)))
    }
}

impl From<bitcoin_rpc_client::Address> for Address {
    fn from(address: bitcoin_rpc_client::Address) -> Self {
        Address::from(address.to_address())
    }
}

impl From<Address> for bitcoin_rpc_client::Address {
    fn from(address: Address) -> Self {
        bitcoin_rpc_client::Address::from(address.to_address())
    }
}

impl From<BitcoinAddress> for Address {
    fn from(address: BitcoinAddress) -> Self {
        Address(address)
    }
}

impl From<Address> for BitcoinAddress {
    fn from(address: Address) -> Self {
        address.0
    }
}

impl Serialize for Address {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0.to_string().as_str())
    }
}

// TODO: this always assumes Mainnet or Testnet
//
// One proposal to properly deserialize Regtest addresses is to implement a deserialiser
// Specific to regtest and pass this deserializer in client_rpc (which knows the network)
// For now, regtest addresses are deserialized as testnet but it is not problematic

impl<'de> Deserialize<'de> for Address {
    fn deserialize<D>(deserializer: D) -> Result<Self, <D as Deserializer<'de>>::Error>
    where
        D: Deserializer<'de>,
    {
        struct Visitor;

        impl<'vde> de::Visitor<'vde> for Visitor {
            type Value = Address;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> Result<(), fmt::Error> {
                formatter.write_str("a Bitcoin address")
            }

            fn visit_str<E>(self, v: &str) -> Result<Address, E>
            where
                E: de::Error,
            {
                let address =
                    BitcoinAddress::from_str(v).map_err(|err| E::custom(format!("{}", err)))?;
                Ok(Address(address))
            }
        }

        deserializer.deserialize_str(Visitor)
    }
}

impl Address {
    pub fn to_address(&self) -> BitcoinAddress {
        self.0.clone()
    }
    pub fn p2wsh(script: &script::Script, network: Network) -> Address {
        Address::from(BitcoinAddress::p2wsh(script, network))
    }
    pub fn p2wpkh(pk: &PublicKey, network: Network) -> Address {
        Address::from(BitcoinAddress::p2wpkh(pk.inner(), network))
    }
    pub fn from_pubkeyhash_and_network(pubkeyhash: PubkeyHash, network: Network) -> Self {
        BitcoinAddress {
            payload: Payload::WitnessProgram(
                WitnessProgram::new(
                    bitcoin_bech32::u5::try_from_u8(0).expect("0 is a valid u5"),
                    pubkeyhash.as_ref().to_vec(),
                    bitcoin_bech32::constants::Network::Regtest,
                ).expect("Any pubkeyhash will succeed in conversion to WitnessProgram"),
            ),
            network,
        }.into()
    }
}

impl fmt::Display for Address {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        fmt.write_str(self.0.to_string().as_str())
    }
}

#[derive(Debug)]
pub enum Error {
    BitcoinError(bitcoin::util::Error),
}

impl From<bitcoin::util::Error> for Error {
    fn from(error: bitcoin::util::Error) -> Self {
        Error::BitcoinError(error)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            &Error::BitcoinError(_) => write!(f, "address is not in bitcoin format"),
        }
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use hex::FromHex;

    #[test]
    fn from_pubkeyhash_and_network() {
        let pubkey_hash = PubkeyHash::from_hex("9a5b5cc47ed3ff2f65295c3563d9cb8f8db5e400").unwrap();
        let address = Address::from_pubkeyhash_and_network(pubkey_hash, Network::Regtest);
        assert_eq!(
            address,
            Address::from_str("bcrt1qnfd4e3r760lj7effts6k8kwt37xmteqq58q6ad").unwrap()
        );
    }
}
