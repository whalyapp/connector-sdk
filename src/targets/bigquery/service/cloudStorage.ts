import { Storage, File } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import { StreamId } from '../../../sdk/models/catalog';
import { haltAndCatchFire } from '../../../sdk/service/error';
import { logger } from '../../../sdk/service/logger';

export const uploadFileInBucket = async (
    streamId: StreamId,
    gcsBuckerName: string,
    filePath: string,
): Promise<File> => {

    try {
        const retryOptions = { autoRetry: true, maxRetries: 20 }

        let storage: Storage = new Storage({ retryOptions: retryOptions });

        const bucketRef = storage.bucket(gcsBuckerName);

        // Bucket should already have been created on the proper Google Cloud region
        await bucketRef.get({ autoCreate: false });

        const destinationFileName = `${streamId}-${uuidv4()}.jsonnl`;

        await bucketRef.upload(filePath, {
            destination: destinationFileName
        })

        logger.info(`🗳  Uploaded ${filePath} into ${gcsBuckerName}/${destinationFileName} GCS File`);

        return bucketRef.file(destinationFileName);
    } catch (err: any) {
        logger.error(`Issue when uploading file into GCS bucket for stream: ${streamId}
        
        Error: ${err.message}
        Stack: ${err.stack}
        Code: ${err.code}
        `)

        if (err.code < 500) {
            await haltAndCatchFire(
                `unauthorized`,
                `We couldn't connect to your Cloud Storage bucket 😔
                    
                    The error from Google is: '${err.message}' 👀
                    
                    Could you troubleshoot your Cloud Storage configuration in Google Cloud and sync again the source? 🙏`,
                `Got error from cloud storage lib`
            )
        }
        throw err;
    }
}
