/**
 * @ledgers { "ledgers": ["bitcoin", "ethereum"] }
 */

import { twoActorTest } from "../../../lib/actor_test_new";
import { AssetKind } from "../../../lib/asset";

describe("Bitcoin and Ethereum based e2e tests", () => {
    it("rfc003-btc-eth-alice-redeems-bob-redeems", async function() {
        await twoActorTest(
            "rfc003-btc-eth-alice-redeems-bob-redeems",
            async function({ alice, bob }) {
                await alice.sendRequest(AssetKind.Bitcoin, AssetKind.Ether);
                await bob.accept();

                await alice.fund();
                await bob.fund();

                await alice.redeem();
                await bob.redeem();

                await alice.assertSwapped();
                await bob.assertSwapped();
            }
        );
    });
    it.skip("rfc003-btc-eth-bob-refunds-alice-refunds", async function() {
        await twoActorTest(
            "rfc003-btc-eth-bob-refunds-alice-refunds",
            async function({ alice, bob }) {
                await alice.sendRequest(AssetKind.Bitcoin, AssetKind.Ether);
                await bob.accept();

                await alice.fund();
                await bob.fund();

                await bob.refund();
                await alice.refund();

                await bob.assertRefunded();
                await alice.assertRefunded();
            }
        );
    });
    it.skip("rfc003-btc-eth-alice-refunds-bob-refunds", async function() {
        await twoActorTest(
            "rfc003-btc-eth-alice-refunds-bob-refunds",
            async function({ alice, bob }) {
                await alice.sendRequest(AssetKind.Bitcoin, AssetKind.Ether);
                await bob.accept();

                await alice.fund();
                await bob.fund();

                await alice.refund();
                await bob.refund();

                await alice.assertRefunded();
                await bob.assertRefunded();
            }
        );
    });
});
