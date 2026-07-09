import {getRuntimeConfig, type KdbConfig, type RuntimeConfig} from "./core/config/index.js"
import { TokenStore } from "./core/auth/token-store.js"
import { HttpClient } from "./core/http/http-client.js"
import { KdbSiteClient } from "./clients/kdb-site-client.js"
import type { ConfigOpts } from "./core/config/index.js"
export {HttpClient, HttpError} from "./core/http/http-client.js"
export {TokenStore} from "./core/auth/token-store.js"
export {getRuntimeConfig, type RuntimeConfig} from "./core/config/index.js"
export {KdbSiteClient} from "./clients/kdb-site-client.js"
import * as path from 'path';
import { fileURLToPath } from "url"
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export interface KdbApiClients {
    config: KdbConfig,
    gen2: KdbSiteClient,
    gen3: KdbSiteClient,
    getClient(generation: keyof RuntimeConfig['environment']): KdbSiteClient;
}
function createSiteClient(generation: keyof RuntimeConfig['environment'], cfg: KdbConfig, tokenStore: TokenStore): KdbSiteClient{
    const env = cfg.environment[generation];
    return new KdbSiteClient(generation, new HttpClient({
        baseUrl: env.base_url,
        timeoutMs: cfg.app.timeout_ms,
        retryCount: cfg.app.retry_count,
        generation,
        tokenStore
    }));
}
export async function createKdbClients(rootDir: string = path.join(__dirname,"../")):Promise<KdbApiClients>{
    const publicConfigPath = path.join(rootDir, './config/kdb.toml');
    const localConfigPath = path.join(rootDir, './config/kdb.local.toml');
    try{
        let testRuntimeConfigOpts: ConfigOpts = {
            publicPath:publicConfigPath,
            localPath:localConfigPath
        };
        const config = await getRuntimeConfig(testRuntimeConfigOpts);
        const tokenStore = new TokenStore(config);
        // TODO: 这里写死了只有gen2 gen3
        const gen2 = createSiteClient("gen2", config, tokenStore);
        const gen3 = createSiteClient("gen3", config, tokenStore);
        return {
            config,
            gen2,
            gen3,
            getClient(generation: keyof RuntimeConfig['environment']): KdbSiteClient{
                return generation === "gen2" ? gen2 : gen3;
            }
        }

    }catch(error: any){
        console.log(`Error :${error.message}`)
        throw error;
    }
}
