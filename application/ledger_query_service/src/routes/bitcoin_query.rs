use bitcoin_support::{Address, SpendsTo, Transaction as BitcoinTransaction};
use http_api_problem::HttpApiProblem;
use link_factory::LinkFactory;
use query_repository::QueryRepository;
use query_result_repository::{QueryResult, QueryResultRepository};
use rocket::{
    response::{
        status::{Created, NoContent},
        Responder,
    },
    State,
};
use rocket_contrib::Json;
use std::sync::Arc;
use transaction_processor::{Query, Transaction};

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct BitcoinQuery {
    to_address: Option<Address>,
}

#[post("/queries/bitcoin", format = "application/json", data = "<query>")]
pub fn handle_new_bitcoin_query<'r>(
    query: Json<BitcoinQuery>,
    link_factory: State<LinkFactory>,
    query_repository: State<Arc<QueryRepository<BitcoinQuery>>>,
) -> Result<impl Responder<'r>, HttpApiProblem> {
    let result = query_repository.save(query.into_inner());

    match result {
        Ok(id) => Ok(created(
            link_factory.create_link(format!("/queries/bitcoin/{}", id)),
        )),
        Err(_) => Err(
            HttpApiProblem::with_title_from_status(500).set_detail("Failed to create new query")
        ),
    }
}

fn created(url: String) -> Created<Option<()>> {
    Created(url, None)
}

impl Query<BitcoinTransaction> for BitcoinQuery {
    fn matches(&self, transaction: &BitcoinTransaction) -> bool {
        match self.to_address {
            Some(ref address) => {
                return transaction.spends_to(address.as_ref());
            }
            None => trace!("to_address not sent, will not used for comparison"),
        }

        false
    }
}

impl Transaction for BitcoinTransaction {
    fn txid(&self) -> String {
        self.txid().to_string()
    }
}

#[derive(Serialize, Clone, Default)]
pub struct RetrieveBitcoinQueryResponse {
    query: BitcoinQuery,
    matching_transactions: QueryResult,
}

#[get("/queries/bitcoin/<id>")]
pub fn retrieve_bitcoin_query(
    id: u32,
    query_repository: State<Arc<QueryRepository<BitcoinQuery>>>,
    query_result_repository: State<Arc<QueryResultRepository>>,
) -> Result<Json<RetrieveBitcoinQueryResponse>, HttpApiProblem> {
    let query = query_repository.get(id).ok_or_else(|| {
        HttpApiProblem::with_title_from_status(404).set_detail("The requested query does not exist")
    })?;

    let result = query_result_repository.get(id).unwrap_or_default();

    Ok(Json(RetrieveBitcoinQueryResponse {
        query,
        matching_transactions: result,
    }))
}

#[delete("/queries/bitcoin/<id>")]
pub fn delete_bitcoin_query(
    id: u32,
    query_repository: State<Arc<QueryRepository<BitcoinQuery>>>,
    query_result_repository: State<Arc<QueryResultRepository>>,
) -> impl Responder<'static> {
    query_repository.delete(id);
    query_result_repository.delete(id);

    NoContent
}