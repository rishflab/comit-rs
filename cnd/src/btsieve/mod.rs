#![warn(rust_2018_idioms)]
#![forbid(unsafe_code)]

pub mod bitcoin;
pub mod ethereum;

use chrono::NaiveDateTime;
use futures::{Future, Stream};

pub trait MatchingTransactions<P>: Send + Sync + 'static {
    type Transaction;

    fn matching_transactions(
        &self,
        pattern: P,
        after: NaiveDateTime,
    ) -> Box<dyn Stream<Item = Self::Transaction, Error = ()> + Send>;
}

pub trait LatestBlock: Send + Sync + 'static {
    type Block;
    type BlockHash;

    fn latest_block(
        &mut self,
    ) -> Box<dyn Future<Item = Self::Block, Error = anyhow::Error> + Send + 'static>;
}

pub trait BlockByHash: Send + Sync + 'static {
    type Block;
    type BlockHash;

    fn block_by_hash(
        &self,
        block_hash: Self::BlockHash,
    ) -> Box<dyn Future<Item = Self::Block, Error = anyhow::Error> + Send + 'static>;
}

pub trait ReceiptByHash: Send + Sync + 'static {
    type Receipt;
    type TransactionHash;

    fn receipt_by_hash(
        &self,
        transaction_hash: Self::TransactionHash,
    ) -> Box<dyn Future<Item = Self::Receipt, Error = anyhow::Error> + Send + 'static>;
}

/// Checks if a given block predates a certain timestamp.
pub trait Predates {
    fn predates(&self, timestamp: NaiveDateTime) -> bool;
}

/// Check if a block was mined after a timestamp.  Both `block_time` and `after`
/// are seconds since epoch.
pub fn block_is_after(block_time: i64, after: i64) -> bool {
    // Ensuring we do not miss a transaction is vital and it doesn't hurt to go back
    // up the chain further than we need to.  So, add an arbitrary  margin.  TCP
    // default timeout (15 minutes) seems nice.
    const MARGIN: i64 = 15 * 60;

    block_time > (after - MARGIN)
}
