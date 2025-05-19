/**
 * Copyright (c) 2024 Capital One
*/
import * as PImage from 'pureimage';
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
    check?: ocr.Check;
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

    public async generateCheckImages(count: number): Promise<void> {
        // Create checks directory if it doesn't exist
        if (!fs.existsSync(this.checksDir)) {
            fs.mkdirSync(this.checksDir, { recursive: true });
        }

        for (let i = 1; i <= count; i++) {
            const filePath = path.join(this.checksDir, `check-${i}.png`);
            const imageData = await this.generateCheckImage(i);
            fs.writeFileSync(filePath, imageData.toString());
            ctx.info(`Generated check image: ${filePath}`);
        }
        if (fs.existsSync('temp.png')) {
            fs.unlinkSync('temp.png');
            ctx.info(`Deleted temporary file: ${'temp.png'}`);
        }
    }

    public async generateTrainingData(modelName: string, count: number): Promise<void> {
        const trainDir = process.env.TESSTRAIN_DATA_DIR || path.join(process.env.HOME || '', '.fin-ocr', 'train', 'tesstrain', 'data');
        const outputDir = path.join(trainDir, `${modelName}-ground-truth`);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        for (let i = 1; i <= count; i++) {
            const [routingNumber, accountNumber, checkNumber] = this.generateRandomCheckDetails();
            const micrLine = `A${routingNumber}A  ${accountNumber}C  ${checkNumber}`;
            
            const imageBuffer = await this.generateMicrLineImage(micrLine);
            const imagePath = path.join(outputDir, `check-${i}.png`);
            fs.writeFileSync(imagePath, imageBuffer.toString());

            // const checkInfo = {
            //     id: `check-${i}`,
            //     fileName: `generated.dat`,
            //     fileSeqNo: i,
            //     routingNumber: routingNumber,
            //     accountNumber: accountNumber,
            //     checkNumber: checkNumber,
            //     auxiliaryOnUs: checkNumber,
            //     payorBankRoutingNumber: routingNumber.slice(0, -1), // First 8 digits
            //     PayorBankCheckDigit: routingNumber.slice(-1),
            //     onUs: `${accountNumber}/`,
            // };
            // const jsonFilePath = path.join(trainDir, `check-${i}.json`);
            // fs.writeFileSync(jsonFilePath, JSON.stringify(checkInfo, null, 4));
    
             const micrGroundTruth = `T${routingNumber}T  ${accountNumber}U  ${checkNumber}`;
              const gtFilePath = path.join(outputDir, `check-${i}.gt.txt`);
              fs.writeFileSync(gtFilePath, micrGroundTruth);



            console.log(`Generated training data for MICR line ${i}`);
        }
        console.log(`Training data generation complete. Files saved in ${trainDir}`);
    }

    private async generateMicrLineImage(micrLine: string): Promise<Buffer> {
        const width = 365; 
        const height = 18; 

        const img = PImage.make(width, height);
        const ctx = img.getContext('2d');

        const micrFont = PImage.registerFont(process.env.TESSDATA_PREFIX + '/fonts/GnuMICR.ttf', 'MICR');
        await micrFont.load();

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#000000';
        ctx.font = '16px MICR';

        ctx.fillText(micrLine, 10, height / 2 + 6); 
        const buffer = await PImage.encodePNGToStream(img, fs.createWriteStream('temp_micr.png'));
        return fs.readFileSync('temp_micr.png');
    }

    private async generateCheckImage(checkSeqNumber: number): Promise<Buffer> {
        const width = 600;
        const height = 250;

        const img = PImage.make(width, height);
        const ctx = img.getContext('2d');

        const micrFont = PImage.registerFont(process.env.TESSDATA_PREFIX + '/fonts/GnuMICR.ttf', 'MICR');
        await micrFont.load();

        const arialFont = PImage.registerFont(process.env.TESSDATA_PREFIX + '/fonts/Roboto-Regular.ttf', 'Roboto');
        await arialFont.load();

        const [routingNumber, accountNumber, checkNumber] = this.generateRandomCheckDetails();

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#000000';
        ctx.strokeRect(10, 10, width - 20, height - 20);

        ctx.fillStyle = '#000000';
        ctx.font = 'bold 18px Roboto';
        ctx.fillText('FIN-OCR Bank', 20, 40);

        ctx.font = 'bold 16px Roboto';
        ctx.fillText('Check No. ' + checkNumber, width - 150, 40);

        const today = new Date();
        const formattedDate = today.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
        });
        ctx.font = '16px Roboto';
        ctx.fillText('Date:', width - 160, 70);
        ctx.fillText(formattedDate, width - 120, 70);

        ctx.fillText('Pay to the Order of:', 20, 100);
        ctx.fillRect(180, 105, 350, 2);

        ctx.fillText('Signature:', width - 200, height - 50);
        ctx.fillRect(width - 120, height - 55, 100, 2);

        ctx.font = '16px MICR';
        const micrLine = `A${routingNumber}A  ${accountNumber}C  ${checkNumber}`;
        ctx.fillText(micrLine, 20, height - 25);


        const buffer = await PImage.encodePNGToStream(img, fs.createWriteStream('temp.png'));

        return fs.readFileSync('temp.png');
    }

    public getChecksDir(): string {
        return this.checksDir;
    }


    private generateRandomCheckDetails(): [string, string, string] {
      const routingNumber = Array.from({
          length: 9
      }, () => Math.floor(Math.random() * 10)).join('');
      const accountNumber = Array.from({
          length: 9
      }, () => Math.floor(Math.random() * 10)).join('');
      const checkNumber = Array.from({
          length: 4
      }, () => Math.floor(Math.random() * 10)).join('');
      return [routingNumber, accountNumber, checkNumber];
    }

    public getContext(): ocr.Context {
        if (this.instance) return this.instance.ocr.ctx;
        return ctx;
    }

    public async scanById(id: number, opts?: { comparer?: CheckComparer, debug?: string[], debugImageDir?: string, logLevel?: string, logFile?: string }): Promise<ocr.CheckScanResponse> {
        const file = this.getCheckFile(id);
        opts = opts || {};
        const comparer = opts.comparer;
        const debug = opts.debug;
        const debugImageDir = opts.debugImageDir;
        const logLevel = opts.logLevel;
        const logFile = opts.logFile;
        return await this.scan(file, {id, comparer, debug, debugImageDir, logLevel, logFile});
    }

    public async preprocessById(id: number, comparer: CheckComparer, groundTruthDir: string): Promise<ocr.CheckScanResponse> {
        const file = this.getCheckFile(id);
        return await this.scan(file, { id, comparer, groundTruthDir, debug: ["MICR"] });
    }

    public async scan(file: string, opts?: { id?: number, comparer?: CheckComparer, groundTruthDir?: string, debug?: string[], debugImageDir?: string, logLevel?: string, logFile?: string}): Promise<ocr.CheckScanResponse> {
        console.log(`Starting scan for file: ${file}`);
        console.log(`opts `+JSON.stringify(opts))
        opts = opts || {};
        const id = opts.id ? opts.id.toString() : file;
        const comparer = opts.comparer;
        const debugImageDir = opts.debugImageDir;

        console.log(`Reading the image file: ${file}`);
        const buffer = fs.readFileSync(file);

        const pp = path.parse(file);
        const format = this.getImageFormat(pp.ext.substring(1));
        console.log(`Parsed file info - Name: ${pp.name}, Extension: ${pp.ext}, Format: ${format}`);

        const req: ocr.CheckScanRequest = {
            id,
            image: { buffer, format },
            translators: this.translators,
            debug: opts.debug,
            logLevel: opts.logLevel,
        };

        console.log(`Sending scan request for ID: ${id}`);
        const sr = await this.getScanResponse(req, { logFile: opts.logFile });
        const resp = sr.response;
        console.log(`Received scan response for ID: ${id}`);

        if (comparer && opts.id) {
            const jsonFile = `${path.join(pp.dir, pp.name)}.json`;
            console.log(`Checking for ground truth JSON file: ${jsonFile}`);

            if (!fs.existsSync(jsonFile)) {
                console.error(`Ground truth file does not exist: ${jsonFile}`);
                throw new Error(`file ${jsonFile} does not exist`);
            }

            const buf = fs.readFileSync(jsonFile);
            const x9 = JSON.parse(buf.toString());
            console.log(`Comparing scan response with ground truth for ID: ${opts.id}`);

            const match = comparer.compare(opts.id, x9, resp, ctx);
            if (resp.images && opts.groundTruthDir && match) {
                console.log(`Ground truth match found for ID: ${opts.id}. Writing ground truth...`);
                await this.writeGroundTruth(resp.images, opts.groundTruthDir, opts.id);
            }
        }

        if (this.correct && opts.id) {
            console.log(`Storing corrections for ID: ${opts.id}`);
            await this.storeCorrections(opts.id, sr.response);
        }

        if (debugImageDir && resp.images) {
            console.log(`Writing debug images for ID: ${opts.id || file}`);
            await this.writeDebugImages(pp.name, resp.images, debugImageDir);
        }

        // sr.check won't be there if this was a CLI action processed
        //  on a REST server
        if (sr.check) {
            sr.check.clear(); // releases native memory
        }

        console.log(`Completed scan for file: ${file}`);
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
            const url = `${this.url}/check/scan`;
            const id = req.id;
            ctx.debug(`Sending scan request to ${url} for request ${id}`);
            req.image.buffer = Util.base64Encode(req.image.buffer as Buffer);
            try {
                const response = await axios.post(url, req, {proxy: false});
                ctx.debug(`Received response from ${url} for request ${id}: ${JSON.stringify(response.data)}`);
                return { response: response.data };
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

    public getCheckFile(id: number): string {
        const extensions = ['tiff','tif', 'png', 'jpg', 'jpeg', 'gif', 'bmp' ];
        for (const ext of extensions) {
            const filePath = path.join(this.checksDir, `check-${id}.${ext}`);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }
        throw new Error(`No image file found for check ID ${id} in supported formats.`);
    }

    private async writeGroundTruth(images: ocr.NamedImageInfo[], dir: string, id: number) {
        let buf = this.getImage(images, "MICR");
        if (!buf) throw Error(`MICR image not found for check ${id}`);
        const jsonFile = this.getCheckJsonFile(id);
        const prefix = path.join(dir, `check-${id}`);
        const preprocessedImageFile = `${prefix}.tif`;
        const groundTruthFile = `${prefix}.gt.txt`;
        // Store the preprocessed image file
        fs.writeFileSync(preprocessedImageFile, buf.toString());
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
        fs.writeFileSync(groundTruthFile, buf.toString());
        console.log(`Generated ground truth for check ${id} and stored in directory ${dir}`);
        ctx.info(`Generated ground truth for check ${id} and stored in directory ${dir}`);
    }

    private async writeDebugImages(title: string, images: ocr.NamedImageInfo[], dir: string) {
        fs.mkdirSync(dir, { recursive: true });
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
            fs.writeFileSync(filePath, Util.imageInfoToBuffer(image).toString());
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
            fs.writeFileSync(`${prefix}.tif`, Buffer.from(buf).toString());
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
