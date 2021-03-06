import { Actors } from "./actors";
import { createActors } from "./create_actors";
import { timeout } from "./utils";

/*
 * This test function will take care of instantiating the actors and tearing them down again
 * after the test, regardless if the test succeeded or failed.
 */
function nActorTest(
    name: string,
    actorNames: ["alice", "bob", "charlie"] | ["alice", "bob"] | ["alice"],
    testFn: (actors: Actors) => Promise<void>
) {
    if (!name.match(/[A-z0-9\-]+/)) {
        // We use the test name as a file name for the log and hence need to restrict it.
        throw new Error(
            `Testname '${name}' is invalid. Only A-z, 0-9 and dashes are allowed.`
        );
    }

    it(name, async function() {
        this.timeout(100_000); // absurd timeout. we have our own one further down
        const actors = await createActors(`${name}.log`, actorNames);

        try {
            await timeout(60000, testFn(actors));
        } catch (e) {
            for (const actorName of actorNames) {
                await actors.getActorByName(actorName).dumpState();
            }
            throw e;
        } finally {
            for (const actorName of actorNames) {
                actors.getActorByName(actorName).stop();
            }
        }
    });
}

/*
 * Instantiates a new e2e test based on three actors
 *
 */
export function threeActorTest(
    name: string,
    testFn: (actors: Actors) => Promise<void>
) {
    nActorTest(name, ["alice", "bob", "charlie"], testFn);
}

/*
 * Instantiates a new e2e test based on two actors
 */
export function twoActorTest(
    name: string,
    testFn: (actors: Actors) => Promise<void>
) {
    nActorTest(name, ["alice", "bob"], testFn);
}

/*
 * Instantiates a new e2e test based on one actor
 */
export function oneActorTest(
    name: string,
    testFn: (actors: Actors) => Promise<void>
) {
    nActorTest(name, ["alice"], testFn);
}
