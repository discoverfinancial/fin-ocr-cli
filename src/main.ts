#!/usr/bin/env node
/**
 * Copyright (c) 2024 Discover Financial Services
*/

import * as ocr from '@discoverfinancial/fin-ocr-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { CheckMgr } from './check.js';
import { Queue } from './queue.js';
import { Util } from './util.js';
import * as readline from 'readline';

function usage(err?: string) {
    if (err) console.log(`ERROR: ${err}`);
    console.log(`Usage: ocr check scan <path-to-check-image>`);
    console.log(`           check test <checkNum> [<numChecks>]`);
    console.log(`           check debug <comma-separated-list-of-check-nums>`);
    console.log(`           check preprocess <output-dir> <checkNum> [<numChecks>]`);
    console.log(`           check generate <numChecks>`);
    console.log(`           buildFiles [<dir>]`);
    process.exit(1);
}

async function main() {
    let argv = process.argv.slice(2);
    if (argv.length < 1) usage();
    const cmd = argv[0];
    argv = argv.slice(1);
    if (cmd === "check") {
        await check(argv);
    } else if (cmd === "buildFiles") {
        await buildFiles(argv);
    } else {
        usage(`Invalid command: ${cmd}`);
    }
}

async function check(argv: string[]) {
    if (argv.length < 2) usage();
    const cmd = argv[0] as string;
    argv = argv.slice(1);
    try {
        if (cmd === "scan") {
            await checkScan(argv);
        } else if (cmd === "test") {
            await checkTest(argv);
        } else if (cmd === "debug") {
            await checkDebug(argv);
        } else if (cmd === "preprocess") {
            await checkPreprocess(argv);
        } else if (cmd === "generate") {
            await checkGenerate(argv);
        }
          else {
            usage(`Invalid check command: ${cmd}`);
        }
    } catch (e: any) {
        if (e.response && e.response.data) console.log(`Error Response: ${JSON.stringify(e.response.data,null,4)}`);
        else if (e.stack) console.log(`Caught Exception: ${e.stack}`);
        else console.log(`Exception: ${JSON.stringify(e)}`);
    }
}

async function checkGenerate(argv: string[]): Promise<void> {
    if (argv.length != 1) usage();
    const count = parseInt(argv[0] as string);
    const cm = await CheckMgr.getInstance();
    if (!cm) return;

    const existingFiles: string[] = [];
    for (let i = 1; i <= count; i++) {
        const filePath = path.join(cm.getChecksDir(), `check-${i}.png`);
        if (fs.existsSync(filePath)) {
            existingFiles.push(filePath);
        }
    }

    if (existingFiles.length > 0) {
        console.log(`The following files already exist:`);
        existingFiles.forEach(file => console.log(file));
        const userConfirmed = await promptUser(`Do you want to overwrite these files? (yes/no): `);

        if (userConfirmed.toLowerCase() !== 'yes' && userConfirmed.toLowerCase() !== 'y') {
            console.log(`Aborting operation. No files were overwritten.`);
            await cm.stop();
            return;
        }
    }

    await cm.generateCheckImages(count);
    await cm.stop();
}

function promptUser(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => rl.question(query, (ans) => {
        rl.close();
        resolve(ans);
    }));
}

async function checkScan(argv: string[]) {
    if (argv.length != 1) usage();
    const path = argv[0] as string;
    const cm = await CheckMgr.getInstance();
    if (!cm) return;
    const result = await cm.scan(path);
    await cm.stop();
    console.log(JSON.stringify(result,null,4));
}

async function checkTest(argv: string[]) {
    if (argv.length < 1 || argv.length > 2) usage();
    const startTime = Date.now();
    const cm = await CheckMgr.getInstance();
    if (!cm) return;
    const comparer = cm.newCheckComparer();
    let id = parseInt(argv[0] as string);
    const count = argv.length == 2 ? parseInt(argv[1] as string) : 1;
    const lastId = id + count - 1;
    const iter = async function(): Promise<ocr.CheckScanResponse | undefined> {
        if (id > lastId) return undefined;
        return cm.scanById(id++, {comparer, logLevel: "warn"});
    };
    const concurrency = Util.getNum("CONCURRENCY", 25) as number;
    try {
        const q = new Queue(iter, concurrency);
        await q.run();
    } finally {
        await cm.stop();
        comparer.logStats();
    }
    const ms = Date.now() - startTime;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms - (mins * 60000)) / 1000);
    console.log(`Execution time: ${mins} minutes, ${secs} seconds`)
}

async function checkDebug(argv: string[]) {
    if (argv.length != 1) usage();
    const ids = (argv[0] as string).split(",");
    const cm = await CheckMgr.getInstance();
    if (!cm) return;
    const ctx = cm.getContext();
    const debugImageDir = "html";
    for (let id of ids) {
        ctx.info(`Scanning check ${id}`);
        await cm.scanById(parseInt(id), {debug: ["*"], debugImageDir, logLevel: "verbose", logFile: `check-${id}.log`});
    }
    await cm.writeDebugPage("Debug Images", ids, debugImageDir);
    await cm.stop();
}

async function checkPreprocess(argv: string[]) {
    if (argv.length < 2 || argv.length > 3) usage();
    let outputDir = argv[0] as string;
    let id = parseInt(argv[1] as string);
    const count = argv.length == 3 ? parseInt(argv[2] as string) : 1;
    const lastId = id + count - 1;
    const cm = await CheckMgr.getInstance();
    if (!cm) return;
    const comparer = cm.newCheckComparer();
    const iter = async function(): Promise<ocr.CheckScanResponse | undefined> {
        if (id > lastId) return undefined;
        return cm.preprocessById(id++, comparer, outputDir);
    };
    const concurrency = Util.getNum("CONCURRENCY", 25) as number;
    const q = new Queue(iter, concurrency);
    await q.run();
    await cm.stop();
}

/**
 * The purpose of this function is to read data from the file system and bundle it into a typescript file
 * which can be read from within a browser.  This is done because we can't read the file system from a browser.
 *
 * For each directory in the "files" directory, build a typescript file and class in the ../ocr/src directory with
 * the name of the directory.  For each file in the subdirectory, base64 encode the contents and store it as the
 * value of an object, where the key of the value is the file name.
 */
async function buildFiles(argv: string[]) {
    if (argv.length > 1) usage();
    const dir = argv.length == 1 ? argv[0] as string : ".";
    ocr.FSMgr.build("files", `${dir}/files.ts`, new MyFileSystem());
}

function logErr(e: any) {
    if (e.response && e.response.data) console.log(`Error Response: ${JSON.stringify(e.response.data,null,4)}`);
    else if (e.stack) console.log(`Caught Exception: ${e.stack}`);
    else console.log(`Exception: ${JSON.stringify(e)}`);
}

class MyFileSystem implements ocr.OSFileSystem {

    public isDir(name: string): boolean {
        try {
            return fs.lstatSync(this.path(name)).isDirectory();
        } catch (e: any) {
            console.log(`Failed in isDir: ${e.message}`);
            return false;
        }
    }

    public isFile(name: string): boolean {
        try {
            return fs.lstatSync(this.path(name)).isFile();
        } catch (e: any) {
            console.log(`Failed in isDir: ${e.message}`);
            return false;
        }
    }

    public readDir(name: string): string[] {
        return fs.readdirSync(this.path(name));
    }

    public readFile(name: string): Buffer {
        return fs.readFileSync(this.path(name));
    }

    public writeFile(name: string, buf: Buffer) {
        fs.writeFileSync(name, buf);
    }

    public appendFile(name: string, buf: Buffer) {
        fs.appendFileSync(name, buf);
    }

    public pathJoin(...paths: string[]): string {
        return path.join(...paths);
    }

    private path(name: string): string {
        return name;
    }

}

main();
