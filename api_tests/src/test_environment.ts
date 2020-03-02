import { Script } from "vm";
import { Config } from "@jest/types";
import { execSync } from "child_process";
import commander from "commander";
import { LedgerRunner } from "../lib/ledgers/ledger_runner";
import { HarnessGlobal } from "../lib/utils";
import NodeEnvironment from "jest-environment-node";
import rimraf from "rimraf";
import * as fs from "fs";

// ************************ //
// Setting global variables //
// ************************ //

interface ConfigInterface {
    ledgers: string[];
}

export class E2ETestEnvironment extends NodeEnvironment {
    private docblockPragmas: string;
    private projectRoot: string;
    private testRoot: string;
    private logDir: string;
    private ledgerRunner: LedgerRunner;
    // @ts-ignore
    public global: HarnessGlobal;

    constructor(config: Config.ProjectConfig, context: any) {
        super(config);

        this.docblockPragmas = context.docblockPragmas;

        this.projectRoot = execSync("git rev-parse --show-toplevel", {
            encoding: "utf8",
        }).trim();
        this.testRoot = this.projectRoot + "/api_tests";
        this.logDir = this.projectRoot + "/api_tests/log";

        rimraf.sync(this.logDir);
        fs.mkdirSync(this.logDir);

        this.ledgerRunner = new LedgerRunner(this.projectRoot, this.logDir);
    }

    async setup() {
        await super.setup();
        console.log(`Starting up test environment`);

        // setup global variables
        this.global.projectRoot = this.projectRoot;
        this.global.testRoot = this.testRoot;
        this.global.logRoot = this.logDir;
        this.global.ledgerConfigs = {};
        this.global.verbose = false;
        if (commander.verbose) {
            this.global.verbose = true;
        }

        // Will trigger if docblock contains @ledgers
        // @ts-ignore
        const configString = this.docblockPragmas.ledgers;
        if (configString) {
            const config: ConfigInterface = JSON.parse(configString);

            // setup ledgers
            if (config.ledgers) {
                console.log(`Initializing ledgers : ${config.ledgers}`);
                await this.ledgerRunner.ensureLedgersRunning(config.ledgers);
                this.global.ledgerConfigs = await this.ledgerRunner.getLedgerConfig();
            }
        }
    }

    async teardown() {
        await super.teardown();
        console.log(`Tearing down test environment.`);
        await this.cleanupAll();
        console.log(`All teared down.`);
    }

    async runScript(script: Script) {
        return super.runScript(script);
    }

    async cleanupAll() {
        try {
            await this.ledgerRunner.stopLedgers();
        } catch (e) {
            console.error("Failed to clean up resources", e);
        }
    }
}

module.exports = E2ETestEnvironment;
