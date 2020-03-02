import { Actors } from "./actors";
import { Actor } from "./actors/actor";
import { createActor } from "./create_actor";
import { HarnessGlobal, mkdirAsync, rimrafAsync } from "./utils";

declare var global: HarnessGlobal;

export async function createActors(
    testName: string,
    actorNames: string[]
): Promise<Actors> {
    const actorsMap = new Map<string, Actor>();
    const testFolderName =
        global.logRoot + "/tests/" + testName.replace(/\//g, "_");

    await ensureLogFiles(testFolderName);
    for (const name of actorNames) {
        actorsMap.set(name, await createActor(`${testFolderName}`, name));
    }

    const actors = new Actors(actorsMap);

    for (const name of actorNames) {
        actorsMap.get(name).actors = actors;
    }

    return Promise.resolve(actors);
}

async function ensureLogFiles(logDir: string) {
    await rimrafAsync(logDir);
    await mkdirAsync(logDir, { recursive: true });
}
