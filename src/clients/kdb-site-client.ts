import { HttpClient, type HttpResponse, type QueryValue} from "../core/http/http-client.js";
import type {RuntimeConfig} from "../core/config/index.js"
export interface GetInfoResponse {
    code?: number | string,
    msg?: string,
    permissions?: string[],
    roles?: string[],
    user?: Record<string, unknown>,
    [key:string]: unknown
}
export class KdbSiteClient {
    constructor(
    public readonly generation: keyof RuntimeConfig['environment'],
    private readonly httpClient: HttpClient
    ){}
    getInfo():Promise<HttpResponse<GetInfoResponse>>{
        return this.httpClient.request<GetInfoResponse> ({
            path:"/getInfo",
            method:"GET"
        });
    }
    request<T>(options:{
        path: string,
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        query?: Record<string, QueryValue>,
        body?: unknown,
        headers?: Record<string, string>
    }): Promise<HttpResponse<T>>{
        return this.httpClient.request<T>(options);
    }
}
