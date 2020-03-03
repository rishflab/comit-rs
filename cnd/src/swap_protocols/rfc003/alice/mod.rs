mod actions;

pub use self::actions::*;

use crate::{
    seed::SwapSeed,
    swap_protocols::rfc003::{
        ledger::Ledger, ledger_state::LedgerState, messages, ActorState, SwapCommunication,
    },
};
use derivative::Derivative;

#[derive(Clone, Derivative)]
#[derivative(Debug, PartialEq)]
pub struct State<AL, BL, AA, BA, AI, BI, AH, BH>
where
    AL: Ledger,
    BL: Ledger,
{
    pub swap_communication: SwapCommunication<AL, BL, AA, BA, AI, BI>,
    pub alpha_ledger_state: LedgerState<AH, AL::Transaction, AA>,
    pub beta_ledger_state: LedgerState<BH, BL::Transaction, BA>,
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub secret_source: SwapSeed, // Used to derive identities and also to generate the secret.
    pub failed: bool,
}

impl<AL, BL, AA, BA, AI, BI, AH, BH> State<AL, BL, AA, BA, AI, BI, AH, BH>
where
    AL: Ledger,
    BL: Ledger,
{
    pub fn proposed(
        request: messages::Request<AL, BL, AA, BA, AI, BI>,
        secret_source: SwapSeed,
    ) -> Self {
        Self {
            swap_communication: SwapCommunication::Proposed { request },
            alpha_ledger_state: LedgerState::NotDeployed,
            beta_ledger_state: LedgerState::NotDeployed,
            secret_source,
            failed: false,
        }
    }

    pub fn accepted(
        request: messages::Request<AL, BL, AA, BA, AI, BI>,
        response: messages::Accept<AI, BI>,
        secret_source: SwapSeed,
    ) -> Self {
        Self {
            swap_communication: SwapCommunication::Accepted { request, response },
            alpha_ledger_state: LedgerState::NotDeployed,
            beta_ledger_state: LedgerState::NotDeployed,
            secret_source,
            failed: false,
        }
    }

    pub fn declined(
        request: messages::Request<AL, BL, AA, BA, AI, BI>,
        response: messages::Decline,
        secret_source: SwapSeed,
    ) -> Self {
        Self {
            swap_communication: SwapCommunication::Declined { request, response },
            alpha_ledger_state: LedgerState::NotDeployed,
            beta_ledger_state: LedgerState::NotDeployed,
            secret_source,
            failed: false,
        }
    }

    pub fn request(&self) -> &messages::Request<AL, BL, AA, BA, AI, BI> {
        self.swap_communication.request()
    }
}

impl<AL, BL, AA, BA, AI, BI, AH, BH> ActorState for State<AL, BL, AA, BA, AI, BI, AH, BH>
where
    AL: Ledger,
    BL: Ledger,
    AA: 'static,
    BA: 'static,
    AI: 'static,
    BI: 'static,
{
    type AL = AL;
    type BL = BL;
    type AA = AA;
    type BA = BA;

    fn expected_alpha_asset(&self) -> &Self::AA {
        &self.swap_communication.request().alpha_asset
    }

    fn expected_beta_asset(&self) -> &Self::BA {
        &self.swap_communication.request().beta_asset
    }

    fn alpha_ledger_mut(&mut self) -> &mut LedgerState<AH, AL::Transaction, AA> {
        &mut self.alpha_ledger_state
    }

    fn beta_ledger_mut(&mut self) -> &mut LedgerState<BH, BL::Transaction, BA> {
        &mut self.beta_ledger_state
    }

    fn swap_failed(&self) -> bool {
        self.failed
    }

    fn set_swap_failed(&mut self) {
        self.failed = true;
    }
}
