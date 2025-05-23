/**
 * Copyright (c) 2024 Capital One
*/
import * as ocr from '@discoverfinancial/fin-ocr-sdk';

export class Util {

    public static getStr(name: string, def: string): string {
        if (name in process.env) {
            return process.env[name] as string;
        }
        return def;
    }
    
    public static getNum(name: string, def?: number): number | undefined {
        if (name in process.env) {
            return parseFloat(process.env[name] as string);
        }
        return def;
    }
    
    public static getBool(name: string, def: boolean): boolean {
        if (name in process.env) {
            const val = process.env[name] as string;
            return val == "true";
        }
        return def;
    }
    
    public static imageInfoToBuffer(info: ocr.NamedImageInfo): Buffer {
        let buf = info.buffer;
        if (typeof buf === "string") buf = Buffer.from(buf, "base64");
        return buf as Buffer;
    }

    public static percent(count: number, total: number): string {
        return `${((count * 100) / total).toFixed(2)}%`;
    }

    public static base64Encode(buf: Buffer): string {
        return buf.toString("base64");
    }

    public static base64Decode(str: string): ArrayBuffer {
        return Buffer.from(str, "base64");
    }

    public static fatal(err: string) {
        console.log(`FATAL ERROR: ${err}`);
        process.exit(1);
    }

}
