import type {RuntimeConfig} from "../config/index.js"
import {TokenStore} from "../auth/token-store.js"
export type QueryValue = string | number | boolean | null | undefined;
export interface HttpClientOptions {
    baseUrl: string,
    timeoutMs: number,
    retryCount: number,
    generation: keyof RuntimeConfig['environment'],
    tokenStore: TokenStore
}
export interface RequestOptions {
    path: string,
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    query?: Record<string, QueryValue>,
    body?: unknown,
    headers?: Record<string, string>
}
export interface HttpResponse<T> {
    data: T,
    status: number,
    headers: Headers
}
export class HttpError extends Error {
    constructor(message: string,
        public readonly status: number,
        public readonly responseBody: string
    ){
        super(message);
        this.name = "HttpError"
    }
}
function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const p = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(p, base);
    if(query){
        for (const [key,value] of Object.entries(query)){
            if(value === undefined || value === null) {
                continue;
            }
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}
export class HttpClient {
    constructor(private readonly options: HttpClientOptions){}
    async request<T>(request: RequestOptions): Promise<HttpResponse<T>>{
        const url = buildUrl(this.options.baseUrl, request.path, request.query);
        let lastError: unknown;
        for(let attempt=0; attempt<=this.options.retryCount; attempt++){
            const controller = new AbortController();
            const timeout = setTimeout(()=>controller.abort(), this.options.timeoutMs);
            try{
                const response = await fetch(url, {
                    method: request.method ?? "GET",
                    headers: {
                        "Content-Type": "application/json;charset=UTF-8",
                        ...this.options.tokenStore.getAuthHeaders(this.options.generation),
                        ...request.headers,
                    },
                    signal: controller.signal, 
                    ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {})
                });
                clearTimeout(timeout);
                const text = await response.text();
                if (!response.ok){
                    throw new HttpError(`HTTP ${response.status}`, response.status, text);
                }
                const data = text ? (JSON.parse(text) as T) : ({} as T);
                return {
                    data,
                    status:response.status,
                    headers:response.headers
                }
            }catch(error){
                // 请求失败（网络断了、超时了、或者后端报 500 导致上面抛出了 HttpError）
                clearTimeout(timeout); // 失败了也要清掉定时器，防止内存泄漏
                lastError = error;     // 记录这次的错误
                
                // 如果当前的尝试次数已经达到了设定的最大重试次数，就不再重试了，直接向外抛出错误
                if (attempt >= this.options.retryCount) {
                throw error;
                }
                // 如果没达到最大次数，什么都不做，循环会自动进入下一次 iteration，再次发起请求
            }
        }
        throw lastError instanceof Error ? lastError : new Error("请求失败");
    }
}
