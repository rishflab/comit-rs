/**
 * @config { "logDir": "lightning_routes" }
 */

import { expect } from "chai";
import { oneActorTest } from "../../lib/actor_test";

// ******************************************** //
// Lightning routes                               //
// ******************************************** //
describe("Dry - lightning routs", () => {
    it("lightning-routes-post-eth-lnbtc-return-400", async function() {
        await oneActorTest(async function({ alice }) {
            const promise = alice.cnd.postHanEthereumEtherHalightLightningBitcoin();
            return expect(promise).to.eventually.be.rejected.then(error => {
                expect(error).to.have.property(
                    "message",
                    "Request failed with status code 400"
                );
            });
        });
    });

    it("lightning-routes-post-erc20-lnbtc-return-400", async function() {
        await oneActorTest(async function({ alice }) {
            const promise = alice.cnd.postHerc20EthereumErc20HalightLightningBitcoin();
            return expect(promise).to.eventually.be.rejected.then(error => {
                expect(error).to.have.property(
                    "message",
                    "Request failed with status code 400"
                );
            });
        });
    });

    it("lightning-routes-post-lnbtc-eth-return-400", async function() {
        await oneActorTest(async function({ alice }) {
            const promise = alice.cnd.postHalightLightningBitcoinHanEthereumEther();
            return expect(promise).to.eventually.be.rejected.then(error => {
                expect(error).to.have.property(
                    "message",
                    "Request failed with status code 400"
                );
            });
        });
    });

    it("lightning-routes-post-lnbtc-erc20-return-400", async function() {
        await oneActorTest(async function({ alice }) {
            const promise = alice.cnd.postHalightLightningBitcoinHerc20EthereumErc20();
            return expect(promise).to.eventually.be.rejected.then(error => {
                expect(error).to.have.property(
                    "message",
                    "Request failed with status code 400"
                );
            });
        });
    });
});
