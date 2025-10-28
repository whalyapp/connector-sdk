import { HTTPHeaders, URLParams } from "../http";

/**
 * C: The type of the tap config
 */
export class Authenticator<C> {

    getAuthHeaders(config: C): Promise<HTTPHeaders> {
        return Promise.resolve({})
    }

    getAuthQS(config: C): Promise<URLParams> {
        return Promise.resolve({})
    }

}