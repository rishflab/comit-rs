import { Script } from "vm";
import { Config } from "@jest/types";
import { execSync } from "child_process";
import commander from "commander";
import { LedgerRunner } from "../lib/ledgers/ledger_runner";
import { HarnessGlobal } from "../lib/utils";
import NodeEnvironment from "jest-environment-node";
import rimraf from "rimraf";
import * as fs from "fs";
import { Mutex } from "async-mutex";

// ************************ //
// Setting global variables //
// ************************ //

interface ConfigInterface {
    ledgers: string[];
    logDir: string;
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
    }

    async setup() {
        await super.setup();
        console.log(`Starting up test environment`);

        // setup global variables
        this.global.projectRoot = this.projectRoot;
        this.global.testRoot = this.testRoot;
        this.global.ledgerConfigs = {};
        this.global.verbose = false;
        this.logDir = "unspecified";

        this.global.parityAccountMutex = new Mutex();

        if (commander.verbose) {
            this.global.verbose = true;
        }

        // Will trigger if docblock contains @ledgers
        // @ts-ignore
        const configString = this.docblockPragmas.config;

        if (configString) {
            const config: ConfigInterface = JSON.parse(configString);
            const logDir = config.logDir ? config.logDir : "unspecified";
            this.logDir = this.projectRoot + "/api_tests/log/" + logDir;

            E2ETestEnvironment.cleanLogDir(this.logDir);

            // setup ledgers
            if (config.ledgers) {
                this.ledgerRunner = new LedgerRunner(
                    this.projectRoot,
                    this.logDir,
                    this.global
                );

                console.log(`Initializing ledgers : ${config.ledgers}`);
                await this.ledgerRunner.ensureLedgersRunning(config.ledgers);
                this.global.ledgerConfigs = await this.ledgerRunner.getLedgerConfig();
            }
        }
        this.global.logRoot = this.logDir;
    }

    private static cleanLogDir(logDir: string) {
        rimraf.sync(logDir);
        fs.mkdirSync(logDir);
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
            if (this.ledgerRunner) {
                await this.ledgerRunner.stopLedgers();
            }
        } catch (e) {
            console.error("Failed to clean up resources", e);
        }
    }
}

module.exports = E2ETestEnvironment;
