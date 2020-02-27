use crate::{
    db::AcceptedSwap,
    seed::DeriveSwapSeed,
    swap_protocols::{
        rfc003::{
            alice, bob, create_swap,
            events::{HtlcDeployed, HtlcFunded, HtlcRedeemed, HtlcRefunded},
            state_store::StateStore,
            Ledger, Request,
        },
        Role,
    },
};

#[allow(clippy::cognitive_complexity)]
pub fn init_accepted_swap<D, AL, BL, AA, BA, AI, BI>(
    dependencies: &D,
    accepted: AcceptedSwap<AL, BL, AA, BA, AI, BI>,
    role: Role,
) -> anyhow::Result<()>
where
    D: StateStore
        + Clone
        + DeriveSwapSeed
        + HtlcFunded<AL, AA, AI>
        + HtlcFunded<BL, BA, BI>
        + HtlcDeployed<AL, AA, AI>
        + HtlcDeployed<BL, BA, BI>
        + HtlcRedeemed<AL, AA, AI>
        + HtlcRedeemed<BL, BA, BI>
        + HtlcRefunded<AL, AA, AI>
        + HtlcRefunded<BL, BA, BI>,
    AL: Ledger,
    BL: Ledger,
    AA: Ord + Send + Sync + 'static,
    BA: Ord + Send + Sync + 'static,
    AI: Send + Sync + 'static + Clone,
    BI: Send + Sync + 'static + Clone,
    Request<AL, BL, AA, BA, AI, BI>: Clone,
{
    let (request, accept, _) = &accepted;

    let id = request.swap_id;
    let seed = dependencies.derive_swap_seed(id);
    tracing::trace!("initialising accepted swap: {}", id);

    match role {
        Role::Alice => {
            let state = alice::State::accepted(request.clone(), accept.clone(), seed);
            StateStore::insert(dependencies, id, state);

            tokio::task::spawn(
                create_swap::<D, alice::State<AL, BL, AA, BA, AI, BI>, AI, BI>(
                    dependencies.clone(),
                    accepted,
                ),
            );
        }
        Role::Bob => {
            let state = bob::State::accepted(request.clone(), accept.clone(), seed);
            StateStore::insert(dependencies, id, state);

            tokio::task::spawn(
                create_swap::<D, bob::State<AL, BL, AA, BA, AI, BI>, AI, BI>(
                    dependencies.clone(),
                    accepted,
                ),
            );
        }
    };

    Ok(())
}
