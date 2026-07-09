import type {RuntimeConfig} from "../config/index.js"
export class TokenStore {
    constructor (private readonly cfg: RuntimeConfig){}
    getToken(generation: keyof RuntimeConfig['environment']): string | undefined{
        const token = this.cfg.credentials[generation].token_env?.trim();
        return token ? token : undefined;
    }

    getAuthHeaders (generation: keyof RuntimeConfig['environment']): Record<string, string>{
        const token = this.getToken(generation);
        return token ? {Authorization: `Bearer ${token}`} : {};
    }
    
}