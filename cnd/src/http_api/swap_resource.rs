#![allow(clippy::type_repetition_in_bounds)]

use crate::{
    db::{Swap, SwapTypes},
    http_api::{
        action::ToSirenAction,
        route_factory::swap_path,
        routes::rfc003::{LedgerState, SwapCommunication, SwapState},
        Http, HttpAsset, HttpLedger,
    },
    swap_protocols::{
        actions::Actions,
        rfc003::{self, state_store::StateStore, ActorState, Ledger},
        HashFunction, SwapId, SwapProtocol,
    },
};
use anyhow::anyhow;
use http_api_problem::HttpApiProblem;
use libp2p::PeerId;
use serde::Serialize;
use warp::http::StatusCode;

#[derive(Debug, Serialize)]
pub struct SwapResource<S> {
    pub id: Http<SwapId>,
    pub role: String,
    pub counterparty: Http<PeerId>,
    pub protocol: Http<SwapProtocol>,
    pub status: SwapStatus,
    pub parameters: SwapParameters,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<S>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SwapParameters {
    alpha_ledger: HttpLedger,
    beta_ledger: HttpLedger,
    alpha_asset: HttpAsset,
    beta_asset: HttpAsset,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SwapStatus {
    InProgress,
    Swapped,
    NotSwapped,
    InternalFailure,
}

impl<AL, BL, AA, BA, AI, BI> From<rfc003::Request<AL, BL, AA, BA, AI, BI>> for SwapParameters
where
    HttpLedger: From<AL>,
    HttpLedger: From<BL>,
    HttpAsset: From<AA>,
    HttpAsset: From<BA>,
{
    fn from(request: rfc003::Request<AL, BL, AA, BA, AI, BI>) -> Self {
        Self {
            alpha_ledger: HttpLedger::from(request.alpha_ledger),
            alpha_asset: HttpAsset::from(request.alpha_asset),
            beta_ledger: HttpLedger::from(request.beta_ledger),
            beta_asset: HttpAsset::from(request.beta_asset),
        }
    }
}

pub enum IncludeState {
    Yes,
    No,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OnFail {
    Error,
    NoAction,
}

// This is due to the introduction of a trust per Bitcoin network in the
// `with_swap_types!` macro and can be iteratively improved
#[allow(clippy::cognitive_complexity)]
pub fn build_rfc003_siren_entity<S>(
    state_store: &S,
    swap: Swap,
    types: SwapTypes,
    include_state: IncludeState,
    on_fail: OnFail,
) -> anyhow::Result<siren::Entity>
where
    S: StateStore,
{
    let id = swap.swap_id;

    with_swap_types!(types, {
        let state = state_store
            .get::<ROLE>(&id)?
            .ok_or_else(|| anyhow!("state store did not contain an entry for {}", id))?;

        if state.swap_failed() && on_fail == OnFail::Error {
            return Err(anyhow!(HttpApiProblem::with_title_and_type_from_status(
                StatusCode::INTERNAL_SERVER_ERROR,
            )));
        }

        let communication = SwapCommunication::from(state.swap_communication.clone());
        let alpha_ledger = LedgerState::from(state.alpha_ledger_state.clone());
        let beta_ledger = LedgerState::from(state.beta_ledger_state.clone());
        let parameters = SwapParameters::from(state.request().clone());
        let actions = state.actions();

        let status = SwapStatus::new(
            communication.status,
            alpha_ledger.status,
            beta_ledger.status,
        );

        let swap = SwapResource {
            id: Http(id),
            status,
            protocol: Http(SwapProtocol::Rfc003(HashFunction::Sha256)),
            parameters,
            role: swap.role.to_string(),
            counterparty: Http(swap.counterparty),
            state: match include_state {
                IncludeState::Yes => Some(SwapState::<
                    AI,
                    BI,
                    <AL as Ledger>::HtlcLocation,
                    <BL as Ledger>::HtlcLocation,
                    <AL as Ledger>::Transaction,
                    <BL as Ledger>::Transaction,
                > {
                    communication,
                    alpha_ledger,
                    beta_ledger,
                }),
                IncludeState::No => None,
            },
        };

        let entity = siren::Entity::default()
            .with_class_member("swap")
            .with_properties(swap)
            .map_err(|e| {
                tracing::error!("failed to set properties of entity: {:?}", e);
                HttpApiProblem::with_title_and_type_from_status(StatusCode::INTERNAL_SERVER_ERROR)
            })?
            .with_link(siren::NavigationalLink::new(&["self"], swap_path(id)))
            .with_link(
                siren::NavigationalLink::new(
                    &["describedBy"],
                    "https://github.com/comit-network/RFCs/blob/master/RFC-003-SWAP-Basic.adoc",
                )
                .with_type("text/html")
                .with_class_member("protocol-spec"),
            );

        if state.swap_failed() && on_fail == OnFail::NoAction {
            return Ok(entity);
        }

        let entity = actions.into_iter().fold(entity, |acc, action| {
            let action = action.to_siren_action(&id);
            acc.with_action(action)
        });

        Ok(entity)
    })
}
