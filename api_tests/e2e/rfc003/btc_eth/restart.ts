import { twoActorTest } from "../../../lib/actor_test";
import { AssetKind } from "../../../lib/asset";

setTimeout(function() {
    twoActorTest("rfc003-btc-eth-cnd-can-be-restarted", async function({
        alice,
        bob,
    }) {
        await alice.sendRequest(AssetKind.Bitcoin, AssetKind.Ether);
        await bob.accept();

        await alice.currentSwapIsAccepted();
        await bob.currentSwapIsAccepted();

        await alice.restart();
        await bob.restart();

        await alice.currentSwapIsAccepted();
        await bob.currentSwapIsAccepted();
    });

    run();
}, 0);
