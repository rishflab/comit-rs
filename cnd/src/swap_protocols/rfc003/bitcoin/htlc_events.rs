use crate::{
    asset,
    btsieve::bitcoin::{
        matching_transaction, BitcoindConnector, Cache, TransactionExt, TransactionPattern,
    },
    htlc_location, identity,
    swap_protocols::{
        ledger::bitcoin,
        rfc003::{
            bitcoin::extract_secret::extract_secret,
            create_swap::HtlcParams,
            events::{
                Deployed, Funded, HtlcDeployed, HtlcFunded, HtlcRedeemed, HtlcRefunded, Redeemed,
                Refunded,
            },
        },
    },
    transaction,
};
use anyhow::Context;
use chrono::NaiveDateTime;

#[async_trait::async_trait]
impl<B> HtlcFunded<B, asset::Bitcoin, identity::Bitcoin> for Cache<BitcoindConnector>
where
    B: bitcoin::Bitcoin + bitcoin::Network,
{
    async fn htlc_funded(
        &self,
        _htlc_params: &HtlcParams<B, asset::Bitcoin, identity::Bitcoin>,
        htlc_deployment: &Deployed<transaction::Bitcoin, htlc_location::Bitcoin>,
        _start_of_swap: NaiveDateTime,
    ) -> anyhow::Result<Funded<transaction::Bitcoin, asset::Bitcoin>> {
        let tx = &htlc_deployment.transaction;
        let asset =
            asset::Bitcoin::from_sat(tx.output[htlc_deployment.location.vout as usize].value);

        Ok(Funded {
            transaction: tx.clone(),
            asset,
        })
    }
}

#[async_trait::async_trait]
impl<B> HtlcDeployed<B, asset::Bitcoin, identity::Bitcoin> for Cache<BitcoindConnector>
where
    B: bitcoin::Bitcoin + bitcoin::Network,
{
    async fn htlc_deployed(
        &self,
        htlc_params: &HtlcParams<B, asset::Bitcoin, identity::Bitcoin>,
        start_of_swap: NaiveDateTime,
    ) -> anyhow::Result<Deployed<transaction::Bitcoin, htlc_location::Bitcoin>> {
        let connector = self.clone();
        let pattern = TransactionPattern {
            to_address: Some(htlc_params.compute_address()),
            from_outpoint: None,
            unlock_script: None,
        };

        let transaction = matching_transaction(connector, pattern, start_of_swap)
            .await
            .context("failed to find transaction to deploy htlc")?;

        let (vout, _txout) = transaction
            .find_output(&htlc_params.compute_address())
            .expect("Deployment transaction must contain outpoint described in pattern");

        Ok(Deployed {
            location: htlc_location::Bitcoin {
                txid: transaction.txid(),
                vout,
            },
            transaction,
        })
    }
}

#[async_trait::async_trait]
impl<B> HtlcRedeemed<B, asset::Bitcoin, identity::Bitcoin> for Cache<BitcoindConnector>
where
    B: bitcoin::Bitcoin + bitcoin::Network,
{
    async fn htlc_redeemed(
        &self,
        htlc_params: &HtlcParams<B, asset::Bitcoin, identity::Bitcoin>,
        htlc_deployment: &Deployed<transaction::Bitcoin, htlc_location::Bitcoin>,
        start_of_swap: NaiveDateTime,
    ) -> anyhow::Result<Redeemed<transaction::Bitcoin>> {
        let connector = self.clone();
        let pattern = TransactionPattern {
            to_address: None,
            from_outpoint: Some(htlc_deployment.location),
            unlock_script: Some(vec![vec![1u8]]),
        };

        let transaction = matching_transaction(connector, pattern, start_of_swap)
            .await
            .context("failed to find transaction to redeem from htlc")?;
        let secret = extract_secret(&transaction, &htlc_params.secret_hash)
            .expect("Redeem transaction must contain secret");

        Ok(Redeemed {
            transaction,
            secret,
        })
    }
}

#[async_trait::async_trait]
impl<B> HtlcRefunded<B, asset::Bitcoin, identity::Bitcoin> for Cache<BitcoindConnector>
where
    B: bitcoin::Bitcoin + bitcoin::Network,
{
    async fn htlc_refunded(
        &self,
        _htlc_params: &HtlcParams<B, asset::Bitcoin, identity::Bitcoin>,
        htlc_deployment: &Deployed<transaction::Bitcoin, htlc_location::Bitcoin>,
        start_of_swap: NaiveDateTime,
    ) -> anyhow::Result<Refunded<transaction::Bitcoin>> {
        let connector = self.clone();
        let pattern = TransactionPattern {
            to_address: None,
            from_outpoint: Some(htlc_deployment.location),
            unlock_script: Some(vec![vec![]]),
        };
        let transaction = matching_transaction(connector, pattern, start_of_swap)
            .await
            .context("failed to find transaction to refund from htlc")?;

        Ok(Refunded { transaction })
    }
}
