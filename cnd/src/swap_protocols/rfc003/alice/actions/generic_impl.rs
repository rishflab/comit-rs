use crate::swap_protocols::{
    actions::Actions,
    rfc003::{
        actions::{Accept, Action, Decline, FundAction, RedeemAction, RefundAction},
        alice,
        create_swap::HtlcParams,
        DeriveSecret, Ledger, LedgerState, SwapCommunication,
    },
};
use std::convert::Infallible;

impl<AL, BL, AA, BA, AI, BI> Actions for alice::State<AL, BL, AA, BA, AI, BI>
where
    AL: Ledger,
    BL: Ledger,
    (AL, AA, AI): FundAction<AL, AA, AI> + RefundAction<AL, AA, AI>,
    (BL, BA, BI): RedeemAction<BL, BA, BI>,
{
    #[allow(clippy::type_complexity)]
    type ActionKind = Action<
        Accept<AL, BL>,
        Decline<BL, BL>,
        Infallible,
        <(AL, AA, AI) as FundAction<AL, AA, AI>>::FundActionOutput,
        <(BL, BA, BI) as RedeemAction<BL, BA, BI>>::RedeemActionOutput,
        <(AL, AA, AI) as RefundAction<AL, AA, AI>>::RefundActionOutput,
    >;

    fn actions(&self) -> Vec<Self::ActionKind> {
        let (request, response) = match self.swap_communication {
            SwapCommunication::Accepted {
                ref request,
                ref response,
            } => (request, response),
            _ => return vec![],
        };
        let alpha_state = &self.alpha_ledger_state;
        let beta_state = &self.beta_ledger_state;

        use self::LedgerState::*;
        let mut actions = match alpha_state {
            NotDeployed => vec![Action::Fund(<(AL, AA, AI)>::fund_action(
                HtlcParams::new_alpha_params(request, response),
            ))],
            IncorrectlyFunded {
                htlc_location,
                fund_transaction,
                ..
            } => vec![Action::Refund(<(AL, AA, AI)>::refund_action(
                HtlcParams::new_alpha_params(request, response),
                htlc_location.clone(),
                &self.secret_source,
                fund_transaction,
            ))],
            Funded {
                htlc_location,
                fund_transaction,
                ..
            } => vec![Action::Refund(<(AL, AA, AI)>::refund_action(
                HtlcParams::new_alpha_params(request, response),
                htlc_location.clone(),
                &self.secret_source,
                fund_transaction,
            ))],
            _ => vec![],
        };

        if let Funded { htlc_location, .. } = beta_state {
            actions.push(Action::Redeem(<(BL, BA, BI)>::redeem_action(
                HtlcParams::new_beta_params(request, response),
                htlc_location.clone(),
                &self.secret_source, // Derive identities with this.
                self.secret_source.derive_secret(), // The secret used by Alice.
            )));
        }
        actions
    }
}
