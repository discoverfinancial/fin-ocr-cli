/**
 * Copyright (c) 2024 Discover Financial Services
*/
import * as ocr from '@discoverfinancial/fin-ocr-sdk';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { Util } from './util.js';

/**
 * The X9 interface defines the check fields of interest which are extracted from an X9 file.
 */
interface X9 {
    payorBankRoutingNumber: string;
    payorBankCheckDigit: string;
    onUs: string;
    auxiliaryOnUs: string;
}

/**
 * Data pertaining to the manual evaluation of a specific set of checks from X9 files.
 */
interface CheckEvalData {
    // The reasons that the et of checks were no
    mismatchesByReason?: {[reason:string]:number[]};
    correctX9?: {[id:string]:string};
}

interface ScanResponse {
    check: ocr.Check;
    response: ocr.CheckScanResponse;
}

const ctx = ocr.Context.obtain("cli", ocr.Config.fromEnv(process.env));

export class CheckMgr {

    public static async getInstance(): Promise<CheckMgr | undefined> {
        const cm = new CheckMgr();
        const ok = await cm.init();
        if (!ok) return undefined;
        return cm;
    }

    private url = process.env.URL;
    private instance?: ocr.CheckMgr;
    private translators = (process.env.TRANSLATORS || "tesseract,opencv").split(",");
    private correct = process.env.ACTUAL != undefined;
    private actual = process.env.ACTUAL;
    private correctionsDir = process.env.CORRECTIONS_DIR || path.join("files","corrections");
    private checksDir = process.env.CHECKS_DIR || `${process.env.HOME}/.fin-ocr/checks`;

    private async init(): Promise<boolean> {
        if (!fs.existsSync(this.correctionsDir)) fs.mkdirSync(this.correctionsDir, {recursive: true});
        if (this.url) {
            const url = `${this.url}/health`;
            try {
                const rtn = await axios.get(url, {proxy: false});
                ctx.debug(`health check worked: ${JSON.stringify(rtn.data)}`);
                return true;
            } catch (e: any) {
                const suffix = e.response ? `: ${e.response.data}`: "";
                ctx.error(`Failed response from ${url}: ${e.message}${suffix}`);
                return false;
            }
        } else {
            this.instance = await ocr.CheckMgr.getInstanceByEnv(process.env);
            return true;
        }
    }

    public getContext(): ocr.Context {
        if (this.instance) return this.instance.ocr.ctx;
        return ctx;
    }

    public async scanById(id: number, opts?: { comparer?: CheckComparer, debug?: string[], debugImageDir?: string, logLevel?: string, logFile?: string }): Promise<ocr.CheckScanResponse> {
        const file = this.getCheckTiffFile(id);
        opts = opts || {};
        const comparer = opts.comparer;
        const debug = opts.debug;
        const debugImageDir = opts.debugImageDir;
        const logLevel = opts.logLevel;
        const logFile = opts.logFile;
        return await this.scan(file, {id, comparer, debug, debugImageDir, logLevel, logFile});
    }

    public async preprocessById(id: number, comparer: CheckComparer, groundTruthDir: string): Promise<ocr.CheckScanResponse> {
        const file = this.getCheckTiffFile(id);
        return await this.scan(file, {id, comparer, groundTruthDir, debug: ["MICR"]});
    }

    public async scan(file: string, opts?: { id?: number, comparer?: CheckComparer, groundTruthDir?: string, debug?: string[], debugImageDir?: string, logLevel?: string, logFile?: string}): Promise<ocr.CheckScanResponse> {
        opts = opts || {};
        const id = opts.id ? opts.id.toString() : file;
        const comparer = opts.comparer;
        const debugImageDir = opts.debugImageDir;
        // Read the image file
        const buffer = fs.readFileSync(file);
        // Get it's format type
        const pp = path.parse(file);
        const format = this.getImageFormat(pp.ext.substring(1));
        const req: ocr.CheckScanRequest = {
            id,
            image: { buffer, format },
            translators: this.translators,
            debug: opts.debug,
            logLevel: opts.logLevel,
        };
        const sr = await this.getScanResponse(req, {logFile: opts.logFile});
        const resp = sr.response;
        if (comparer && opts.id) {
            const jsonFile = `${path.join(pp.dir,pp.name)}.json`;
            // If the ground truth file exists, read it and compare results
            if (!fs.existsSync(jsonFile)) throw new Error(`file ${jsonFile} does not exist`);
            const buf = fs.readFileSync(jsonFile);
            const x9 = JSON.parse(buf.toString());
            const match = comparer.compare(opts.id, x9, resp, ctx);
            if (resp.images && opts.groundTruthDir && match) {
                await this.writeGroundTruth(resp.images, opts.groundTruthDir, opts.id);
            }
        }
        if (this.correct && opts.id) {
            await this.storeCorrections(opts.id, sr.response);
        }
        if (debugImageDir && resp.images) {
            await this.writeDebugImages(pp.name, resp.images, debugImageDir);
        }
        sr.check.clear(); // releases native memory
        return resp;
    }

    public newCheckComparer(): CheckComparer {
        const checkEvalData = this.getCheckEvalData();
        return new CheckComparer({checkEvalData});
    }

    public async stop() {
        if (this.instance) await this.instance.stop();
    }

    private async getScanResponse(req: ocr.CheckScanRequest, opts?: {logFile?: string}): Promise<ScanResponse> {
        opts = opts || {};
        if (this.url) {
            const url = `${this.url}/check/scan"}`;
            const id = req.id;
            ctx.debug(`Sending scan request to ${url} for request ${id}`);
            req.image.buffer = Util.base64Encode(req.image.buffer as Buffer);
            try {
                const response = await axios.post(url, req, {proxy: false});
                ctx.debug(`Received response from ${url} for request ${id}: ${JSON.stringify(response.data)}`);
                return response.data;
            } catch (e: any) {
                ctx.error(`Error from ${url} for request ${id}: ${e.message}`);
                throw e;
            }
        } else {
            const cm = this.instance as ocr.CheckMgr;
            if (!cm) throw new Error("unexpected state");
            const check = cm.newCheck(req.id)
            if (opts.logFile) {
                check.ctx.setConsole(new console.Console(fs.createWriteStream(opts.logFile)))
            }
            const response = await check.scan(req);
            return { check, response };
        }
    }

    private getImageFormat(ext: string): ocr.ImageFormat {
        if (ext === 'tif' || ext === 'tiff') return ocr.ImageFormat.TIF;
        if (ext === 'jpg' || ext === 'jpeg') return ocr.ImageFormat.JPG;
        if (ext === 'png') return ocr.ImageFormat.PNG;
        if (ext === 'gif') return ocr.ImageFormat.GIF;
        if (ext === 'bmp') return ocr.ImageFormat.BMP;
        throw new Error(`Unsupported image extension: ${ext}`);
    }

    private async writeGroundTruth(images: ocr.NamedImageInfo[], dir: string, id: number) {
        let buf = this.getImage(images, "MICR");
        if (!buf) throw Error(`MICR image not found for check ${id}`);
        const jsonFile = this.getCheckJsonFile(id);
        const prefix = path.join(dir, `check-${id}`);
        const preprocessedImageFile = `${prefix}.tiff`;
        const groundTruthFile = `${prefix}.json`;
        // Store the preprocessed image file
        fs.writeFileSync(preprocessedImageFile, buf);
        // Read and parse the JSON file
        var x9;
        var gt: string;
        const correctX9 = this.getCheckEvalData().correctX9;
        if (correctX9 && id in correctX9) {
            // if training on the test set, we could correct the x9
            gt = correctX9[id] || "";
        } else {
            buf = fs.readFileSync(jsonFile);
            x9 = JSON.parse(buf.toString());
            // Create the various fields and concatenate them
            const route = x9.payorBankRoutingNumber + x9.payorBankCheckDigit;
            const onUs = x9.onUs.replace('/', 'U');
            const auxOnUs = x9.auxiliaryOnUs;
            gt = auxOnUs ? `U${auxOnUs}U ` : "";
            gt = gt + `T${route}T${onUs}`;
        }
        // Write the string to the ground truth file
        buf = Buffer.from(gt, 'utf8');
        fs.writeFileSync(groundTruthFile, buf);
        ctx.info(`Generated ground truth for check ${id} and stored in directory ${dir}`);
    }

    private async writeDebugImages(title: string, images: ocr.NamedImageInfo[], dir: string) {
        let htmlContents = `<html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
        </head>
        <body>`;
        let count = 1;
        for (const image of images) {
            const fileName = `${title}-${image.name}.jpg`;
            const filePath = path.join(dir, fileName);
            fs.writeFileSync(filePath, Util.imageInfoToBuffer(image));
            htmlContents += `
            <h1>${count}-${image.name}</h1>
            <p><img src="${fileName}" width="${image.width}" height="${image.height}"></p>
            `;
            count++;
        }
        htmlContents += "\n    </body>\n</html>";
        const htmlPath = path.join(dir, `${title}.html`);
        fs.writeFileSync(htmlPath, htmlContents);
        ctx.debug(`Debug images are available at ${htmlPath}`)
    }

    public async writeDebugPage(title: string, checkNums: string[], dir: string) {
        let htmlContents = `<html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
        </head>
        <body>
        <ul>
        <h1>${title}</h1>\n`;
        for (const cn of checkNums) {
            htmlContents += `<li><a href="check-${cn}.html">check ${cn}</a></li>\n`;
        }
        htmlContents += "    </ul>\n    </body>\n</html>";
        const htmlPath = path.join(dir, `debugImages.html`);
        fs.writeFileSync(htmlPath, htmlContents);
        ctx.info(`Debug images are available at ${htmlPath}`)
    }

    private async storeCorrections(id: number, csr: ocr.CheckScanResponse) {
        const tr = csr.translators["opencv"] as ocr.CheckScanTranslatorResponse;
        const details = tr.details;
        if (!details) return;
        const chars = details.chars;
        if (!chars) return;
        for (let i = 0; i < chars.length; i++) {
            const char = chars[i] as ocr.TranslatorChar;
            if (!char.corrected) continue;
            const image = char.image as ocr.Image;
            const numContours = char.numContours as number;
            if (!image || !numContours) continue;
            const value = char.getBest().value;
            const buf = await image.toBuffer(ocr.ImageFormat.TIF);
            const prefix = path.join(this.correctionsDir, `check-${id}-char-${i}`);
            fs.writeFileSync(`${prefix}.tif`, Buffer.from(buf));
            fs.writeFileSync(`${prefix}.ct`, `${value}:${numContours}`);
            ctx.debug(`Stored correction for character ${i} of check ${id}`);
        }
    }

    private getImage(images: ocr.NamedImageInfo[], name: string): Buffer | undefined {
        for (const image of images) {
            if (image.name == name) {
                return Util.imageInfoToBuffer(image);
            }
        }
        return undefined;
    }

    public getCheckTiffFile(id: number): string {
        return `${this.checksDir}/check-${id}.tiff`;
    }

    private getCheckJsonFile(id: number): string {
        return `${this.checksDir}/check-${id}.json`;
    }

    public getCheckEvalData(): CheckEvalData {
        const file = process.env.CHECK_EVAL_DATA;
        if (!file) return {};
        const buf = fs.readFileSync(file);
        try {
            return JSON.parse(buf.toString());
        } catch(e: any) {
            Util.fatal(`Failed parsing ${file}: ${e.message}`);
            return {};
        }
    }

}

class CheckComparer {

    private matches: number[] = [];
    private mismatches: number[] = [];
    private wrongInX9: number[] = [];
    private correctX9: {[id:string]:string};
    private alreadyEvaluated: number[] = [];
    private toEvaluate: number[] = [];
    private toReevaluate: number[] = [];
    private showMatches: boolean;
    private comparisonCount = 0;

    constructor(opts?: {showMatches?: boolean, checkEvalData?: CheckEvalData, invalidIds?: number[]}) {
        opts = opts || {};
        this.showMatches = opts.showMatches || false;
        const cd = opts.checkEvalData || {};
        this.correctX9 = cd.correctX9 || {};
        if (cd.mismatchesByReason) {
            for (const ids of Object.values(cd.mismatchesByReason)) {
                for (const id of ids) this.alreadyEvaluated.push(id);
            }
        }
    }

    public compare(id: number, x9: X9, csr: ocr.CheckScanResponse, ctx: ocr.Context): boolean {
        const idStr = id.toString();
        var ci: ocr.CheckInfo;
        if (idStr in this.correctX9) {
            ci = ocr.CheckUtil.micrToCheckInfo(id.toString(),ctx,this.correctX9[idStr]);
        } else {
            ci = ocr.CheckUtil.x9ToCheckInfo(x9,ctx);
        }

        let match = false;
        for (const trName in csr.translators) {
           const tr = csr.translators[trName] as ocr.CheckScanTranslatorResponse;
           const r = tr.result;
           const mismatchedFields: string[] = [];
           if (ci.routingNumber !== r.routingNumber) mismatchedFields.push("routingNumber");
           if (ci.accountNumber !== r.accountNumber) mismatchedFields.push("accountNumber");
           if (ci.checkNumber !== r.checkNumber) mismatchedFields.push("checkNumber");
           if (mismatchedFields.length === 0) {
              ctx.debug(`${trName} matched check ${id}`);
              match = true;
              break;
           }
           ctx.debug(`${trName} mismatched fields ${JSON.stringify(mismatchedFields)} of check ${id}`);
        }
        if (!match) {
            ctx.debug(`mismatched check ${id}`);
        }
        const wrong = id in this.correctX9;
        const evaluated = this.alreadyEvaluated.indexOf(id) >= 0;
        if (wrong) {
            this.wrongInX9.push(id);
        } else if (!match && !evaluated) {
            ctx.info(`Evaluate check ${id}`);
            this.toEvaluate.push(id);
        } else if (match && evaluated) {
            ctx.info(`Reevaluate check ${id}`);
            this.toReevaluate.push(id);
        }
        if (match) this.matches.push(id);
        else this.mismatches.push(id);
        ctx.info(`Check ${id}: match=${match} (${this.getMatchPercentage()})`);
        this.comparisonCount++;
        return match;
    }

    public logStats() {
        if (this.comparisonCount === 0) return;
        this.matches.sort((a,b) => a - b);
        this.mismatches.sort((a,b) => a - b);
        this.toEvaluate.sort((a,b) => a - b);
        this.toReevaluate.sort((a,b) => a - b);
        if (this.showMatches) ctx.info(`Matches: ${JSON.stringify(this.matches)}`);
        ctx.info(`Mismatches: ${JSON.stringify(this.mismatches)}`);
        ctx.info(`Mismatches to evaluate: ${JSON.stringify(this.toEvaluate)}`);
        ctx.info(`Matches to reevaluate: ${JSON.stringify(this.toReevaluate)}`);
        ctx.info(`Counts: match=${this.matches.length}, x9Wrong=${this.wrongInX9.length}, total=${this.total()}`);
        ctx.info(`Percentage: match=${this.getMatchPercentage()}, x9Wrong=${this.getX9WrongPercentage()}`);
    }

    public getMatchPercentage(): string {
        return Util.percent(this.matches.length, this.total());
    }

    public getX9WrongPercentage(): string {
        return Util.percent(this.wrongInX9.length, this.total());
    }

    public total(): number {
        return this.matches.length + this.mismatches.length;
    }

}
