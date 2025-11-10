import { Storage } from '@google-cloud/storage';
import { logger } from './logger';
import { format } from 'util';

const getStorage = () => new Storage({ retryOptions: { autoRetry: true, maxRetries: 20 } });

export const readObjectAsString = async (
    bucketName: string,
    objectPath: string,
): Promise<string> => {
    try {
        const storage = getStorage();
        const bucketRef = storage.bucket(bucketName);
        await bucketRef.get({ autoCreate: false });
        const fileRef = bucketRef.file(objectPath);
        const [exists] = await fileRef.exists();
        if (!exists) {
            throw new Error(`GCS object not found: gs://${bucketName}/${objectPath}`);
        }
        const [contents] = await fileRef.download();
        return contents.toString('utf8');
    } catch (err: any) {
        throw new Error(format(`error reading GCS object gs://${bucketName}/${objectPath}, err: %s`, err?.message));
    }
}

export const writeStringObject = async (
    bucketName: string,
    objectPath: string,
    contents: string,
): Promise<void> => {
    try {
        const storage = getStorage();
        const bucketRef = storage.bucket(bucketName);
        await bucketRef.get({ autoCreate: false });
        const fileRef = bucketRef.file(objectPath);
        await fileRef.save(contents, { contentType: 'application/json' });
        logger.info(`🗳  Uploaded object to gs://${bucketName}/${objectPath}`);
    } catch (err: any) {
        throw new Error(format(`error writing GCS object gs://${bucketName}/${objectPath}, err: %s`, err?.message));
    }
}


