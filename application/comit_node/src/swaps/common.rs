use std::{fmt, str::FromStr};
use uuid::{ParseError, Uuid};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TradeId(Uuid);

impl Default for TradeId {
    fn default() -> Self {
        TradeId(Uuid::new_v4())
    }
}

impl FromStr for TradeId {
    type Err = ParseError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Uuid::from_str(s).map(TradeId)
    }
}

impl From<Uuid> for TradeId {
    fn from(uuid: Uuid) -> Self {
        TradeId(uuid)
    }
}

impl From<TradeId> for Uuid {
    fn from(trade_id: TradeId) -> Self {
        trade_id.0
    }
}

impl fmt::Display for TradeId {
    fn fmt(&self, f: &mut fmt::Formatter) -> Result<(), fmt::Error> {
        self.0.fmt(f)
    }
}
