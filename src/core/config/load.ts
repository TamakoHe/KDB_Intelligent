import * as fs from 'fs';
import * as path from 'path';
import * as toml from '@iarna/toml';
import { fileURLToPath } from 'url';
import {z} from 'zod';
import {publicConfigSchema, localConfigSchema} from './schema.js';
type publicConfig = z.infer<typeof publicConfigSchema>;
type localConfig = z.infer<typeof localConfigSchema>;
type RuntimeConfig = publicConfig & localConfig;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)
export async function readTomlConfig<T extends z.ZodTypeAny> (
    filePath: string,
    schema: T
): Promise<z.infer<T>>{
    try{
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const rawData = toml.parse(fileContent);
        const validatedData = schema.parse(rawData);
        return validatedData;
    }catch(error){
        if (error instanceof z.ZodError) {
            console.error(`文件 [${filePath}] 格式错误！详细信息:`, error.format());
        } else {
        console.error(`读取文件 [${filePath}] 失败:`, error);
        }
        throw error;
    }
}
export function strictMerge<T extends Record<string, any>, U extends Record<string, any>>(obj1: T, obj2: U, pathPrefix: string = ""): T & U{
    const result: any = {...obj1};
    for(const key in obj2){
        const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        if (key in result){
            const val1 = result[key];
            const val2 = obj2[key];
            const isObj1 = typeof val1 === 'object' && val1 !== null && Array.isArray(val1);
            const isObj2 = typeof val2 === 'object' && val2 !== null && Array.isArray(val2);
            if (isObj1 && isObj2){
                result[key] = strictMerge(val1, val2, currentPath);
            }else{
                throw new Error(`❌ 配置合并冲突: 字段 "${currentPath}" 存在重叠，无法合并！`);
            }
        }else{
            result[key] = obj2[key];
        }
    }
    return result as T & U;
} 
async function testLoadConfig(){
    const publicConfigPath = path.join(__dirname, '../../../config/kdb.toml');
    const localConfigPath = path.join(__dirname, '../../../config/kdb.local.toml');
  
    try {
        // 1. 读取并验证 public 配置
        const publicCfg = await readTomlConfig(publicConfigPath, publicConfigSchema);
        console.log("✅ Public 配置读取成功!");
        
        // 2. 读取并验证 local 配置
        const localCfg = await readTomlConfig(localConfigPath, localConfigSchema);
        console.log("✅ Local 配置读取成功!");

        // 3. 严格合并为 RuntimeConfig
        console.log("正在合并配置...");
        const runtimeConfig: RuntimeConfig = strictMerge(publicCfg, localCfg);
        
        console.log("配置合并成功！最终 RuntimeConfig 如下:");
        console.log(runtimeConfig);

        } catch (e: any) {
        console.error("配置加载或合并失败:", e.message);
        }
}
// testLoadConfig();