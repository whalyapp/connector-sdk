import fs from "fs";

export const writeFile = (path: string, content: string): Promise<void> => {
    return Promise.resolve(fs.writeFileSync(path, content));
}

export const readAndParseJSONFile = (path: string) => {
    if (!fs.existsSync(path)) {
        throw new Error(`File \`${path}\` wasn't found at: ${process.cwd()}`)
    }
    const raw = fs.readFileSync(path);
    const parsed = JSON.parse(raw.toString())

    return parsed;
}