export interface HTTPHeaders {
    [headerName: string]: any;
}

export interface URLParams {
    [paramName: string]: any;
}

export type HTTPMethod = "GET" | "POST";