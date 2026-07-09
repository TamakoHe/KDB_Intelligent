import {readTomlConfig, strictMerge} from './load.js';
import { z } from 'zod';
import { publicConfigSchema, localConfigSchema } from './schema.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
export interface ConfigOpts{
    publicPath: string,
    localPath: string
}
export type KdbConfig = z.infer<typeof publicConfigSchema>;
export type LocalConfig = z.infer<typeof localConfigSchema>;
export type RuntimeConfig = KdbConfig & LocalConfig;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)
export async function getRuntimeConfig(opts?: ConfigOpts): Promise<RuntimeConfig>{
    const publicPath = opts?.publicPath || path.join(__dirname, '../../../config/kdb.toml');
    const localPath = opts?.localPath || path.join(__dirname, '../../../config/kdb.local.toml');
    const [publicCfg, localCfg] = await Promise.all([
        readTomlConfig(publicPath, publicConfigSchema),
        readTomlConfig(localPath, localConfigSchema)
    ]);
    return strictMerge(publicCfg, localCfg);
}
export function resolveGeneration(batteryId: string, cfg: RuntimeConfig): "gen2" | "gen3" {
    if (!batteryId || typeof batteryId !== 'string') {
        throw new Error("无效的电池编号：编号不能为空");
    }
    const prefix = batteryId.charAt(0);

    if (cfg.routing.gen3_prefixes.includes(prefix)){
        return "gen3";
    }else if (cfg.routing.gen2_prefixes.includes(prefix)){
        return "gen2";
    }else{
        throw new Error(`未知的电池编号前缀 [${prefix}]，无法解析对应的数据库代数。`);
    }
}
async function testLoadRuntimeConfig(){
    const publicConfigPath = path.join(__dirname, '../../../config/kdb.toml');
    const localConfigPath = path.join(__dirname, '../../../config/kdb.local.toml');
    try{
        let testRuntimeConfigOpts: ConfigOpts = {
            publicPath:publicConfigPath,
            localPath:localConfigPath
        };
        const  testRuntimeConfig = await getRuntimeConfig(testRuntimeConfigOpts);
        console.log(testRuntimeConfig);

    }catch(error: any){
        console.log(`Error:${error.message}`)
    }
}
// testLoadRuntimeConfig();