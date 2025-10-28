import fs from 'fs-extra';
import uniqueId from 'lodash/uniqueId.js';
import { StreamId } from '../catalog';
import { TempFile } from './models';

export const createTemporaryFileStream = (streamId: StreamId): TempFile => {
    fs.ensureDirSync("./tmp")
    const path = `./tmp/${safePath(streamId)}-${uniqueId()}.tmp`;
    const writeStream = fs.createWriteStream(path, {flags: "w"});

    return {
        stream: writeStream,
        path
    };
}

export function safePath(path: string): string {
    let formattedPath = path;
    formattedPath = formattedPath.replace(/^The\s+/gi, '');
    formattedPath = formattedPath.replace(/\s+(?:\(|\[)?Dis(?:c|k) (?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d)+(?:\)|\])?/gi, '');
    formattedPath = formattedPath.replace(/\s+/gi, '_');
    formattedPath = formattedPath.replace(/(?:\'|`)/gi, '');
    formattedPath = replaceAccented(formattedPath);
    formattedPath = replaceSymbols(formattedPath);
    formattedPath = formattedPath.replace(/(?:[^a-z0-9])+/gi, '_');

    return formattedPath;
};

function replaceAccented(str: string) {
    str = str.replace(/(?:\xC0|\xC1|\xC2|\xC3|\xC4|\xC5)/g, 'A');
    str = str.replace(/(?:\xC7)/g, 'C');
    str = str.replace(/(?:\xC8|\xC9|\xCA|\xCB)/g, 'E');
    str = str.replace(/(?:\xCC|\xCD|\xCE|\xCF)/g, 'I');
    str = str.replace(/(?:\xD2|\xD3|\xD4|\xD6|\xD5)/g, 'O');
    str = str.replace(/(?:\xD9|\xDA|\xDB|\xDC)/g, 'U');
    str = str.replace(/(?:\xDD|\x9F)/g, 'Y');
    str = str.replace(/(?:\xD1)/g, 'N');
    str = str.replace(/(?:\xC6)/g, 'Ae');
    str = str.replace(/(?:\xDF)/g, 'ss');
    str = str.replace(/(?:\xE0|\xE1|\xE2|\xE4|\xE5|\xE3)/g, 'a');
    str = str.replace(/(?:\xE7)/g, 'c');
    str = str.replace(/(?:\xE8|\xE9|\xEA|\xEB)/g, 'e');
    str = str.replace(/(?:\xEC|\xED|\xEE|\xEF)/g, 'i');
    str = str.replace(/(?:\xF2|\xF3|\xF4|\xF6|\xF5)/g, 'o');
    str = str.replace(/(?:\xF9|\xFA|\xFB|\xFC)/g, 'u');
    str = str.replace(/(?:\xFD|\xFF)/g, 'y');
    str = str.replace(/(?:\xF1)/g, 'n');
    str = str.replace(/(?:\xE6)/g, 'ae');
    return str;
}

function replaceSymbols(str: string) {
    str = str.replace(/(?:\(|\))/g, '');
    str = str.replace(/(?:\.|\?)/g, '');
    str = str.replace(/(?:_+)/g, '_');
    str = str.replace(/(?:\$+)/g, 's');
    return str;
}