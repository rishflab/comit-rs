const chai = require('chai');
const test_lib = require("../test_lib.js");
const should = chai.should();
chai.use(require('chai-http'));
const web3 = test_lib.web3();
const BigNumber = require('bignumber.js');
const beta_asset = new BigNumber(web3.utils.toWei("10", 'ether'));

const alice = test_lib.comit_conf("alice", {
    txid: process.env.BTC_FUNDED_TX,
    value: parseInt(process.env.BTC_FUNDED_AMOUNT + '00000000'),
    private_key: process.env.BTC_FUNDED_PRIVATE_KEY,
    vout: parseInt(process.env.BTC_FUNDED_VOUT)
});
const bob = test_lib.comit_conf("bob", {});

const alice_final_address = "0x00a329c0648769a73afac7f9381e08fb43dbea72";

describe("RFC003 HTTP API", () => {

    let swap_url;
    it("Returns 404 when you try and GET a non-existent swap", async () => {
        await chai.request(alice.comit_node_url())
            .get('/swaps/rfc003/deadbee-dead-beef-dead-deadbeefdead')
            .then((res) => {
                res.should.have.status(404);
            });
    });

    //FIXME: We're returning 405 when we should be returning 404
    // it("Returns a 404 for an action on a non-existent swap", async () => {
    //     return chai.request(alice.comit_node_url())
    //         .post('/swaps/rfc003/deadbee-dead-beef-dead-deadbeefdead/accept')
    //         .send({
    //         }).then((res) => {
    //             res.should.have.status(404);
    //         });
    // });

    it("Alice should be able to make first swap request via HTTP api", async () => {
        await chai.request(alice.comit_node_url())
            .post('/swaps/rfc003')
            .send({
                "alpha_ledger": {
                    "name": "Bitcoin",
                    "network": "regtest"
                },
                "beta_ledger": {
                    "name": "Ethereum"
                },
                "alpha_asset": {
                    "name": "Bitcoin",
                    "quantity": "100000000"
                },
                "beta_asset": {
                    "name": "Ether",
                    "quantity": beta_asset.toString(),
                },
                "alpha_ledger_refund_identity": "ac2db2f2615c81b83fe9366450799b4992931575",
                "beta_ledger_success_identity": alice_final_address,
                "alpha_ledger_lock_duration": 144
            }).then((res) => {
                res.error.should.equal(false);
                res.should.have.status(201);
                swap_location = res.headers.location;
                swap_location.should.be.a('string');
                swap_url = swap_location;
            });
    });

    it("After making a request Alice should be able to get it", async () => {
        await chai.request(alice.comit_node_url())
            .get(swap_url).then((res) => {
                res.body.role.should.equal('Alice');
                res.should.have.status(200);
            });
    });

    it("Shows both swaps in GET /swaps", async () => {
        await chai.request(alice.comit_node_url())
            .get('/swaps').then((res) => {
                res.should.have.status(200);
                let embedded = res.body._embedded;
                embedded.should.be.a('object');
                let swap = embedded.swaps[0];
                swap.protocol.should.equal('rfc003');
                swap.state.should.equal('Start');
                let links = swap._links;
                links.self.href.should.equal(swap_url);
            });
    });

    it("Shows both swaps as Start on Bob's side", async () => {
        await chai.request(bob.comit_node_url())
            .get('/swaps').then((res) => {
                let embedded = res.body._embedded;
                let swap = embedded.swaps[0];
                swap.protocol.should.equal('rfc003');
                swap.state.should.equal('Start');
            });
    });
});
