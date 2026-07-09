import { HttpClient, type HttpResponse, type QueryObject } from "../core/http/http-client.js";
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
        query?: QueryObject,
        body?: unknown,
        headers?: Record<string, string>,
        timeoutMs?: number
    }): Promise<HttpResponse<T>>{
        return this.httpClient.request<T>(options);
    }

    requestArrayBuffer(options:{
        path: string,
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        query?: QueryObject,
        body?: unknown,
        headers?: Record<string, string>,
        timeoutMs?: number
    }): Promise<HttpResponse<ArrayBuffer>>{
        return this.httpClient.requestArrayBuffer(options);
    }

    requestRaw(options:{
        path: string,
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        query?: QueryObject,
        body?: unknown,
        headers?: Record<string, string>,
        timeoutMs?: number
    }): Promise<HttpResponse<{ text: string }>>{
        return this.httpClient.requestRaw(options);
    }
}
