use crate::{
    asset::{self},
    identity,
    swap_protocols::{
        actions::{ethereum, Actions},
        ledger::Ethereum,
        rfc003::{
            actions::{erc20, Accept, Action, Decline, FundAction, RedeemAction, RefundAction},
            bob,
            create_swap::HtlcParams,
            Ledger, LedgerState, SwapCommunication,
        },
    },
};
use std::convert::Infallible;

impl<AL, AA, AI> Actions for bob::State<AL, Ethereum, AA, asset::Erc20, AI, identity::Ethereum>
where
    AL: Ledger,
    (AL, AA, AI): RedeemAction<AL, AA, AI>,
{
    #[allow(clippy::type_complexity)]
    type ActionKind = Action<
        Accept<AL, Ethereum>,
        Decline<AL, Ethereum>,
        ethereum::DeployContract,
        ethereum::CallContract,
        <(AL, AA, AI) as RedeemAction<AL, AA, AI>>::RedeemActionOutput,
        ethereum::CallContract,
    >;

    fn actions(&self) -> Vec<Self::ActionKind> {
        let (request, response) = match &self.swap_communication {
            SwapCommunication::Proposed { .. } => {
                return vec![
                    Action::Accept(Accept::new()),
                    Action::Decline(Decline::new()),
                ];
            }
            SwapCommunication::Accepted {
                ref request,
                ref response,
            } => (request, response),
            _ => return vec![],
        };

        let alpha_state = &self.alpha_ledger_state;
        let beta_state = &self.beta_ledger_state;

        use self::LedgerState::*;

        let mut actions = match (alpha_state, beta_state) {
            (Funded { htlc_location, .. }, Redeemed { secret, .. }) => {
                vec![Action::Redeem(<(AL, AA, AI)>::redeem_action(
                    HtlcParams::new_alpha_params(request, response),
                    htlc_location.clone(),
                    &*self.secret_source, // Derive identities with this.
                    *secret,              /* Bob uses the secret learned from Alice's redeem
                                           * action. */
                ))]
            }
            (Funded { .. }, NotDeployed) => vec![Action::Deploy(erc20::deploy_action(
                HtlcParams::new_beta_params(request, response),
            ))],
            (Funded { .. }, Deployed { htlc_location, .. }) => {
                vec![Action::Fund(erc20::fund_action(
                    HtlcParams::new_beta_params(request, response),
                    request.beta_asset.token_contract,
                    *htlc_location,
                ))]
            }
            _ => vec![],
        };

        if let Funded { htlc_location, .. } = beta_state {
            actions.push(Action::Refund(erc20::refund_action(
                request.beta_ledger.chain_id,
                request.beta_expiry,
                *htlc_location,
            )));
        }
        actions
    }
}

impl<BL, BA, BI> Actions for bob::State<Ethereum, BL, asset::Erc20, BA, identity::Ethereum, BI>
where
    BL: Ledger,
    (BL, BA, BI): FundAction<BL, BA, BI> + RefundAction<BL, BA, BI>,
{
    #[allow(clippy::type_complexity)]
    type ActionKind = Action<
        Accept<Ethereum, BL>,
        Decline<Ethereum, BL>,
        Infallible,
        <(BL, BA, BI) as FundAction<BL, BA, BI>>::FundActionOutput,
        ethereum::CallContract,
        <(BL, BA, BI) as RefundAction<BL, BA, BI>>::RefundActionOutput,
    >;

    fn actions(&self) -> Vec<Self::ActionKind> {
        let (request, response) = match &self.swap_communication {
            SwapCommunication::Proposed { .. } => {
                return vec![
                    Action::Accept(Accept::new()),
                    Action::Decline(Decline::new()),
                ];
            }
            SwapCommunication::Accepted {
                ref request,
                ref response,
            } => (request, response),
            _ => return vec![],
        };

        let alpha_state = &self.alpha_ledger_state;
        let beta_state = &self.beta_ledger_state;

        use self::LedgerState::*;
        let mut actions = match (alpha_state, beta_state) {
            (Funded { htlc_location, .. }, Redeemed { secret, .. }) => vec![Action::Redeem(
                erc20::redeem_action(*htlc_location, *secret, request.alpha_ledger.chain_id),
            )],
            (Funded { .. }, NotDeployed) => vec![Action::Fund(<(BL, BA, BI)>::fund_action(
                HtlcParams::new_beta_params(request, response),
            ))],
            _ => vec![],
        };

        if let Funded {
            htlc_location,
            fund_transaction,
            ..
        } = beta_state
        {
            actions.push(Action::Refund(<(BL, BA, BI)>::refund_action(
                HtlcParams::new_beta_params(request, response),
                htlc_location.clone(),
                &*self.secret_source,
                fund_transaction,
            )))
        }
        actions
    }
}
